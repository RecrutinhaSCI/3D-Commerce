import { Router } from 'express';
import { healthRouter } from './health.routes';
import { authRouter } from '../modules/auth/auth.routes';
import { usersRouter } from '../modules/users/users.routes';
import { categoriesRouter } from '../modules/categories/categories.routes';
import { productsRouter } from '../modules/products/products.routes';
import { cartRouter } from '../modules/cart/cart.routes';
import { ordersRouter } from '../modules/orders/orders.routes';
import { paymentsRouter } from '../modules/payments/payments.routes';
import { shippingRouter } from '../modules/shipping/shipping.routes';
import { contactRouter } from '../modules/contact/contact.routes';
import { seoRouter } from '../modules/seo/seo.routes';
import { quotesRouter } from '../modules/quotes/quotes.routes';
import { settingsRouter } from '../modules/settings/settings.routes';
import { bannersRouter } from '../modules/banners/banners.routes';
import { testimonialsRouter } from '../modules/testimonials/testimonials.routes';
import { couponsRouter } from '../modules/coupons/coupons.routes';
import { scriptsRouter } from '../modules/scripts/scripts.routes';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes';
import { diagnosticsRouter } from './diagnostics.routes';
import { integrationsRouter } from '../modules/integrations/integrations.routes';

/**
 * Router raiz. Os routers internos por enquanto estão vazios (R1).
 * Eles serão preenchidos nas próximas rodadas, sem mexer neste arquivo.
 */
export const apiRouter = Router();

// Health check — no path raiz e também em /api/health
apiRouter.use(healthRouter);

// Módulos da API (todos sob /api/* exceto quando definirem subpaths próprios)
apiRouter.use('/api/auth', authRouter);
apiRouter.use('/api', usersRouter);
apiRouter.use('/api', categoriesRouter);
apiRouter.use('/api', productsRouter);
apiRouter.use('/api', cartRouter);
apiRouter.use('/api', ordersRouter);
apiRouter.use('/api', paymentsRouter);
apiRouter.use('/api', shippingRouter);
apiRouter.use('/api', contactRouter);
apiRouter.use('/api', seoRouter);
apiRouter.use('/api', quotesRouter);
apiRouter.use('/api', settingsRouter);
apiRouter.use('/api', bannersRouter);
apiRouter.use('/api', testimonialsRouter);
apiRouter.use('/api', couponsRouter);
apiRouter.use('/api', scriptsRouter);
// OAuth de integrações (Melhor Envio) — início/status admin + callback PÚBLICO.
// Precisa vir ANTES do dashboardRouter: ele aplica auth+admin via `router.use`
// a tudo que chega até ele, o que bloquearia o callback (401).
apiRouter.use('/api', integrationsRouter);
apiRouter.use('/api', dashboardRouter);
// Diagnóstico de proxy/IP (admin) — ver diagnostics.routes.ts.
apiRouter.use('/api', diagnosticsRouter);
