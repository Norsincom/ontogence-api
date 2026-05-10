import { Controller, Post, Get, Body, Req, Res, HttpCode } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { StripeService } from './stripe.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Request, Response } from 'express';

@ApiTags('stripe')
@Controller('stripe')
export class StripeController {
  constructor(private stripeService: StripeService) {}

  @Post('checkout')
  @ApiBearerAuth()
  createCheckout(
    @CurrentUser() user: any,
    @Body() body: { product: string; successUrl: string; cancelUrl: string },
  ) {
    return this.stripeService.createCheckoutSession(
      user.id,
      user.email,
      user.name || '',
      body.product as any,
      body.successUrl,
      body.cancelUrl,
    );
  }

  @Get('invoices')
  @ApiBearerAuth()
  getInvoices(@CurrentUser() user: any) {
    return this.stripeService.getInvoices(user.id);
  }

  @Post('webhook')
  @Public()
  @HttpCode(200)
  async handleWebhook(@Req() req: Request, @Res() res: Response) {
    const sig = req.headers['stripe-signature'] as string;

    // Test event bypass
    let event: any;
    try {
      event = this.stripeService.constructEvent(req.body as Buffer, sig);
    } catch {
      return res.status(400).json({ error: 'Webhook signature verification failed' });
    }

    if (event.id?.startsWith('evt_test_')) {
      return res.json({ verified: true });
    }

    if (event.type === 'checkout.session.completed') {
      await this.stripeService.handleCheckoutComplete(event.data.object);
    }

    return res.json({ received: true });
  }
}
