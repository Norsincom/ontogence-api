import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

const BUCKET = 'vault';

// Valid UploadCategory enum values — must match Prisma schema exactly
const VALID_UPLOAD_CATEGORIES = new Set([
  'bloodwork', 'mri', 'ct_scan', 'pet_scan', 'pathology', 'biopsy',
  'genomics', 'microbiome', 'metabolomics', 'proteomics', 'epigenetics',
  'imaging', 'ecg', 'sleep', 'nutrition', 'supplements', 'medications',
  'symptoms', 'intake_form', 'insurance', 'protocols', 'prescriptions',
  'appointments', 'other',
]);
function sanitizeCategory(category: string): string {
  if (VALID_UPLOAD_CATEGORIES.has(category)) return category;
  const legacyMap: Record<string, string> = {
    labs: 'bloodwork', lab: 'bloodwork', pdf: 'other', photo: 'imaging',
    image: 'imaging', photos: 'imaging', protocol: 'protocols',
    prescription: 'prescriptions', appointment: 'appointments',
    supplement: 'supplements', medication: 'medications', symptom: 'symptoms',
  };
  return legacyMap[category?.toLowerCase()] || 'other';
}

@Injectable()
export class VaultService {
  private supabase: SupabaseClient;

  constructor(private prisma: PrismaService) {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  async getFiles(userId: string, category?: string) {
    return this.prisma.upload.findMany({
      where: {
        userId,
        archivedAt: null, // never show archived files to clients
        ...(category ? { category: category as any } : {}),
      },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async getUploadUrl(userId: string, fileName: string, mimeType: string, category: string) {
    const ext = fileName.split('.').pop();
    const storageKey = `${userId}/${category}/${uuidv4()}.${ext}`;

    const { data, error } = await this.supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(storageKey);

    if (error) throw new Error(`Storage error: ${error.message}`);

    // Supabase returns a relative URL like /object/upload/sign/...
    // Prepend the full storage base URL so the browser can PUT directly to Supabase.
    const supabaseBase = process.env.SUPABASE_URL!.replace(/\/$/, '');
    const absoluteUploadUrl = data.signedUrl.startsWith('http')
      ? data.signedUrl
      : `${supabaseBase}/storage/v1${data.signedUrl}`;

    return {
      uploadUrl: absoluteUploadUrl,
      storageKey,
      token: data.token,
    };
  }

  async confirmUpload(
    userId: string,
    storageKey: string,
    originalName: string,
    mimeType: string,
    sizeBytes: number,
    category: string,
    notes?: string,
    // Attribution fields
    createdByUserId?: string,
    createdByRole?: string,
    createdByName?: string,
  ) {
    const safeCategory = sanitizeCategory(category);
    const { data } = await this.supabase.storage.from(BUCKET).getPublicUrl(storageKey);
    const storageUrl = data.publicUrl;
    const sha256Hash = crypto.createHash('sha256').update(storageKey + Date.now()).digest('hex');

    const upload = await this.prisma.upload.create({
      data: {
        id: uuidv4(),
        userId,
        fileName: storageKey.split('/').pop() || originalName,
        originalName,
        mimeType,
        sizeBytes,
        category: safeCategory as any,
        storageKey,
        storageUrl,
        sha256Hash,
        notes: notes || null,
        // Attribution — captured server-side, immutable after creation
        createdByUserId: createdByUserId || userId,
        createdByRole: createdByRole || 'client',
        createdByName: createdByName || null,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId,
        action: 'upload_created',
        resourceType: 'upload',
        resourceId: upload.id,
        metadata: {
          fileName: originalName,
          category,
          createdByRole: createdByRole || 'client',
          createdByName: createdByName || null,
        },
      },
    });

    return upload;
  }

  async getDownloadUrl(userId: string, fileId: string, requestingUserId: string, requestingRole: string) {
    const file = await this.prisma.upload.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('File not found');

    // Archived files are only accessible to admins
    if (file.archivedAt && !['admin', 'super_admin'].includes(requestingRole)) {
      throw new ForbiddenException('File has been archived');
    }

    // Only owner, consultant assigned to client, or admin can download
    if (file.userId !== requestingUserId && !['admin', 'super_admin', 'consultant'].includes(requestingRole)) {
      throw new ForbiddenException('Access denied');
    }

    const { data, error } = await this.supabase.storage
      .from(BUCKET)
      .createSignedUrl(file.storageKey, 3600);

    if (error) throw new Error(`Storage error: ${error.message}`);

    await this.prisma.upload.update({
      where: { id: fileId },
      data: { accessedAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: requestingUserId,
        action: 'upload_accessed',
        resourceType: 'upload',
        resourceId: fileId,
      },
    });

    return { url: data.signedUrl, fileName: file.originalName };
  }

  /**
   * Archive a file (soft-delete). Clients CANNOT call this.
   * Only admin/super_admin roles are permitted.
   * Hard-delete from storage is reserved for super_admin only.
   */
  async archiveFile(requestingUserId: string, requestingRole: string, fileId: string) {
    if (!['admin', 'super_admin'].includes(requestingRole)) {
      throw new ForbiddenException('Only administrators can archive files');
    }

    const file = await this.prisma.upload.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('File not found');

    if (requestingRole === 'super_admin') {
      // Super admin: hard-delete from storage AND soft-delete record
      await this.supabase.storage.from(BUCKET).remove([file.storageKey]);
    }

    await this.prisma.upload.update({
      where: { id: fileId },
      data: {
        archivedAt: new Date(),
        archivedById: requestingUserId,
        updatedByUserId: requestingUserId,
        updatedByRole: requestingRole,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: requestingUserId,
        action: 'upload_deleted',
        resourceType: 'upload',
        resourceId: fileId,
        metadata: {
          fileName: file.originalName,
          action: requestingRole === 'super_admin' ? 'hard_delete' : 'soft_archive',
        },
      },
    });

    return { success: true };
  }
}
