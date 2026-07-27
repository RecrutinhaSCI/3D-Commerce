import { Router } from 'express';
import { healthRouter } from './health.routes';
import { authRouter } from '../modules/auth/auth.routes';
import { usersRouter } from '../modules/users/users.routes';
import { categoriesRouter } from '../modules/categories/categories.routes';
import { productsRouter } from '../modules/products/products.routes';
import { cartRouter } from '../modules/cart/cart.routes';
import { ordersRouter } from '../modules/orders/orders.routes';
import { quotesRouter } from '../modules/quotes/quotes.routes';
import { settingsRouter } from '../modules/settings/settings.routes';
import { bannersRouter } from '../modules/banners/banners.routes';
import { testimonialsRouter } from '../modules/testimonials/testimonials.routes';
import { couponsRouter } from '../modules/coupons/coupons.routes';
import { scriptsRouter } from '../modules/scripts/scripts.routes';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes';
import { paymentsRouter } from '../modules/payments/payments.routes';

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
apiRouter.use('/api', quotesRouter);
apiRouter.use('/api', settingsRouter);
apiRouter.use('/api', bannersRouter);
apiRouter.use('/api', testimonialsRouter);
apiRouter.use('/api', couponsRouter);
apiRouter.use('/api', scriptsRouter);
// Payments ANTES do dashboard: o dashboardRouter aplica auth+admin com
// `router.use()` sem path, o que intercepta qualquer rota registrada depois.
apiRouter.use('/api', paymentsRouter);
apiRouter.use('/api', dashboardRouter);
