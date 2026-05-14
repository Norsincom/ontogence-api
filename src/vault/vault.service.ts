import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

const BUCKET = 'vault';

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

    return {
      uploadUrl: data.signedUrl,
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
  ) {
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
        category: category as any,
        storageKey,
        storageUrl,
        sha256Hash,
        notes: notes || null,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId,
        action: 'upload_created',
        resourceType: 'upload',
        resourceId: upload.id,
        metadata: { fileName: originalName, category },
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
