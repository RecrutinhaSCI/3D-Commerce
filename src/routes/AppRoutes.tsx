import { createBrowserRouter } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { AdminLayout } from '@/components/layout/AdminLayout';
import Home from '@/pages/public/Home';
import Shop from '@/pages/public/Shop';
import Category from '@/pages/public/Category';
import Product from '@/pages/public/Product';
import Cart from '@/pages/public/Cart';
import Checkout from '@/pages/public/Checkout';
import NotFound from '@/pages/public/NotFound';

// Páginas públicas menos críticas — code-split
const QuoteWhatsapp = lazy(() => import('@/pages/public/QuoteWhatsapp'));
const About = lazy(() => import('@/pages/public/About'));
const Materials = lazy(() => import('@/pages/public/Materials'));
const Blog = lazy(() => import('@/pages/public/Blog'));
const BlogPost = lazy(() => import('@/pages/public/BlogPost'));
const FAQ = lazy(() => import('@/pages/public/FAQ'));
const HowToBuy = lazy(() => import('@/pages/public/HowToBuy'));
const ReturnsPolicy = lazy(() => import('@/pages/public/ReturnsPolicy'));
const PrivacyPolicy = lazy(() => import('@/pages/public/PrivacyPolicy'));
const Contact = lazy(() => import('@/pages/public/Contact'));
const CustomerLogin = lazy(() => import('@/pages/public/CustomerLogin'));
const CustomerRegister = lazy(() => import('@/pages/public/CustomerRegister'));
const ForgotPassword = lazy(() => import('@/pages/public/ForgotPassword'));
const ResetPassword = lazy(() => import('@/pages/public/ResetPassword'));
const VerifyEmail = lazy(() => import('@/pages/public/VerifyEmail'));
const CustomerAccount = lazy(() => import('@/pages/public/CustomerAccount'));
const CustomerOrders = lazy(() => import('@/pages/public/CustomerOrders'));

// Admin inteiro — code-split (visitante público não baixa)
const AdminLogin = lazy(() => import('@/pages/admin/Login'));
const AdminDashboard = lazy(() => import('@/pages/admin/Dashboard'));
const AdminProducts = lazy(() => import('@/pages/admin/Products'));
const AdminProductForm = lazy(() => import('@/pages/admin/ProductForm'));
const AdminCategories = lazy(() => import('@/pages/admin/Categories'));
const AdminSeasonal = lazy(() => import('@/pages/admin/SeasonalCategory'));
const AdminBanners = lazy(() => import('@/pages/admin/Banners'));
const AdminOrders = lazy(() => import('@/pages/admin/Orders'));
const AdminQuotes = lazy(() => import('@/pages/admin/Quotes'));
const AdminTestimonials = lazy(() => import('@/pages/admin/Testimonials'));
const AdminCoupons = lazy(() => import('@/pages/admin/Coupons'));
const AdminScripts = lazy(() => import('@/pages/admin/Scripts'));
const AdminSettings = lazy(() => import('@/pages/admin/Settings'));

function PageFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-9 w-9 animate-spin rounded-full border-2 border-ink/20 border-t-ink" aria-label="Carregando" />
    </div>
  );
}

function L({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/loja', element: <Shop /> },
      { path: '/categoria/:slug', element: <Category /> },
      { path: '/produto/:slug', element: <Product /> },
      { path: '/carrinho', element: <Cart /> },
      { path: '/checkout', element: <Checkout /> },
      { path: '/orcamento', element: <L><QuoteWhatsapp /></L> },
      { path: '/sobre', element: <L><About /></L> },
      { path: '/materiais', element: <L><Materials /></L> },
      { path: '/blog', element: <L><Blog /></L> },
      { path: '/blog/:slug', element: <L><BlogPost /></L> },
      { path: '/faq', element: <L><FAQ /></L> },
      { path: '/como-comprar', element: <L><HowToBuy /></L> },
      { path: '/trocas-devolucoes', element: <L><ReturnsPolicy /></L> },
      { path: '/privacidade', element: <L><PrivacyPolicy /></L> },
      { path: '/contato', element: <L><Contact /></L> },
      { path: '/login', element: <L><CustomerLogin /></L> },
      { path: '/criar-conta', element: <L><CustomerRegister /></L> },
      { path: '/esqueci-senha', element: <L><ForgotPassword /></L> },
      { path: '/redefinir-senha', element: <L><ResetPassword /></L> },
      { path: '/verificar-email', element: <L><VerifyEmail /></L> },
      { path: '/minha-conta', element: <L><CustomerAccount /></L> },
      { path: '/meus-pedidos', element: <L><CustomerOrders /></L> },
      { path: '*', element: <NotFound /> },
    ],
  },
  { path: '/admin/login', element: <L><AdminLogin /></L> },
  {
    path: '/admin',
    element: <AdminLayout />,
    children: [
      { index: true, element: <L><AdminDashboard /></L> },
      { path: 'produtos', element: <L><AdminProducts /></L> },
      { path: 'produtos/novo', element: <L><AdminProductForm /></L> },
      { path: 'produtos/:id', element: <L><AdminProductForm /></L> },
      { path: 'categorias', element: <L><AdminCategories /></L> },
      { path: 'categoria-sazonal', element: <L><AdminSeasonal /></L> },
      { path: 'banners', element: <L><AdminBanners /></L> },
      { path: 'pedidos', element: <L><AdminOrders /></L> },
      { path: 'orcamentos', element: <L><AdminQuotes /></L> },
      { path: 'cupons', element: <L><AdminCoupons /></L> },
      { path: 'depoimentos', element: <L><AdminTestimonials /></L> },
      { path: 'scripts', element: <L><AdminScripts /></L> },
      { path: 'configuracoes', element: <L><AdminSettings /></L> },
    ],
  },
]);
