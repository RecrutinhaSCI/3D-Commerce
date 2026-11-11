// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import Orders from './Orders';
import CustomerOrders from '@/pages/public/CustomerOrders';
import { PaymentPhase } from '@/pages/public/Checkout';
import { apiOrderToInternal } from '@/services/adapters';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { orderService } from '@/services/orderService';
import { paymentService } from '@/services/paymentService';
import { orderReference } from '@/utils/orderReference';
import type { ApiOrder } from '@/services/types';

vi.mock('@/services/orderService', () => ({ orderService: { listAdmin: vi.fn(), listMine: vi.fn() } }));
vi.mock('@/services/paymentService', () => ({ paymentService: { createPayment: vi.fn(), getPaymentStatus: vi.fn() } }));
vi.mock('@/components/checkout/PaymentBrick', () => ({ CardPaymentBrick: () => <div>Cartão</div> }));
vi.mock('@/store/useCustomerAuthStore', () => ({ useCurrentCustomer: () => ({ id: 'customer-test' }), useCustomerAuthStore: vi.fn() }));
vi.mock('@/components/ui/Drawer', () => ({ Drawer: ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) => open ? <div role="dialog" aria-label={title}>{children}</div> : null }));
vi.mock('@/components/ui/Modal', () => ({ Modal: ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) => open ? <div role="dialog" aria-label={title}>{children}</div> : null }));
vi.mock('@/components/admin/shipment/ShipmentPanel', () => ({ ShipmentPanel: ({ orderId, orderPublicCode }: { orderId: string; orderPublicCode?: string }) => <div data-testid="shipment" data-order-id={orderId} data-public-code={orderPublicCode} /> }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const order: ApiOrder = {
  id: 'technical-order-cuid', publicCode: '3DCOMMERCE00042', userId: 'customer-test',
  customerName: 'Cliente Teste', customerEmail: 'test@example.invalid', customerPhone: '11999999999', customerCpf: null,
  addressSnapshot: { recipientName: 'Cliente Teste', phone: '11999999999', zipCode: '01001000', street: 'Rua Teste', number: '1', district: 'Centro', city: 'São Paulo', state: 'SP', country: 'Brasil' },
  subtotal: 100, shippingValue: 10, shippingMethod: 'PAC', shippingServiceName: null,
  shippingCarrier: null, shippingDeadlineDays: null, shippingQuoteSource: null,
  discountValue: 0, paymentDiscount: 0, totalBeforeDiscount: 110, total: 110,
  couponId: null, couponCode: null, couponDiscountType: null, status: 'PENDING', paymentMethod: 'PIX', paymentStatus: 'PENDING',
  notes: null, mpPaymentId: null, trackingCode: null, createdAt: '2026-01-01T12:00:00Z', updatedAt: '2026-01-01T12:00:00Z', items: [],
};
const pagination = { page: 1, limit: 100, total: 1, totalPages: 1 };
let host: HTMLDivElement; let root: Root;
const status = vi.fn(); const tracking = vi.fn(); const cancel = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  const internal = apiOrderToInternal(order);
  status.mockResolvedValue({ ...internal, status: 'pago', paymentStatus: 'PAID' });
  tracking.mockResolvedValue(undefined);
  cancel.mockResolvedValue({ order: { ...internal, status: 'cancelado', paymentStatus: 'CANCELED' }, result: 'canceled' });
  useAdminDataStore.setState({ orders: [internal], updateOrderStatus: status, setTrackingCode: tracking, cancelOrder: cancel });
  vi.mocked(orderService.listAdmin).mockResolvedValue({ orders: [order], pagination });
  vi.mocked(orderService.listMine).mockResolvedValue({ orders: [order], pagination });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function render(node: React.ReactNode) { await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>)); }
async function click(text: string, container: ParentNode = host) {
  const el = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
  expect(el).toBeTruthy(); await act(async () => el.click());
}
async function input(el: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
}
it('adapter keeps technical ID separate and legacy responses remain usable', () => {
  const mapped = apiOrderToInternal(order);
  expect(mapped.id).toBe(order.id); expect(mapped.publicCode).toBe(order.publicCode);
  expect(orderReference(mapped)).toBe('3DCOMMERCE00042');
  expect(orderReference(apiOrderToInternal({ ...order, publicCode: undefined }))).toBe(order.id);
});
it('admin displays commercial code; status/tracking/shipping use technical ID', async () => {
  await render(<Orders />);
  expect(host.querySelector('tbody')!.textContent).toContain(order.publicCode);
  expect(host.querySelector('tbody')!.textContent).not.toContain(order.id);
  await click('Detalhes →');
  expect(host.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('Pedido 3DCOMMERCE00042');
  expect(host.textContent).toContain(`ID interno: ${order.id}`);
  expect(host.querySelector('[data-testid="shipment"]')!.getAttribute('data-order-id')).toBe(order.id);
  const select = host.querySelectorAll<HTMLSelectElement>('[role="dialog"] select')[0];
  await act(async () => { select.value = 'pago'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(status).toHaveBeenCalledWith(order.id, { status: 'pago' });
  await input(host.querySelector<HTMLInputElement>('input[placeholder="Ex.: AA123456789BR"]')!, 'AB123456789BR');
  await click('Salvar'); expect(tracking).toHaveBeenCalledWith(order.id, 'AB123456789BR');
});
it('cancel action retains the technical ID', async () => {
  await render(<Orders />); await click('Detalhes →'); await click('Cancelar pedido');
  const confirm = host.querySelector('[role="dialog"][aria-label="Cancelar pedido?"]')!;
  await click('Cancelar pedido', confirm); expect(cancel).toHaveBeenCalledWith(order.id);
});
it('search requests older orders from the server by commercial code', async () => {
  useAdminDataStore.setState({ orders: [] });
  await render(<Orders />);
  await input(host.querySelector<HTMLInputElement>('input[aria-label="Buscar pedidos"]')!, '3DCOMMERCE00042');
  await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 300)); });
  expect(orderService.listAdmin).toHaveBeenCalledWith({ search: '3DCOMMERCE00042', limit: 100 });
  expect(host.querySelector('tbody')!.textContent).toContain('3DCOMMERCE00042');
});
it('customer sees commercial reference while payment route keeps the technical ID', async () => {
  await render(<CustomerOrders />);
  expect(host.textContent).toContain('3DCOMMERCE00042'); expect(host.textContent).not.toContain(order.id);
  const button = host.querySelector<HTMLButtonElement>('.card')!;
  await act(async () => button.click());
  expect(host.querySelector('a[href^="/pagar/"]')!.getAttribute('href')).toBe(`/pagar/${order.id}`);
});
async function payment() {
  await render(<PaymentPhase order={order} amount={110} payerEmail="test@example.invalid" payerName="Cliente Teste" payerCpf="52998224725" payerAddress={{ cep: '01001000', street: 'Rua Teste', number: '1', district: 'Centro', city: 'São Paulo', state: 'SP' }} onApproved={vi.fn()} onOrderPlaced={vi.fn()} />);
}
it('Pix and status checks use technical ID while the summary shows publicCode', async () => {
  vi.mocked(paymentService.createPayment).mockResolvedValue({ qr_code: 'test-code', qr_code_base64: '', ticket_url: 'https://example.invalid/pix', paymentStatus: 'PENDING' });
  vi.mocked(paymentService.getPaymentStatus).mockResolvedValue({ paymentStatus: 'PENDING' });
  await payment(); expect(host.textContent).toContain('3DCOMMERCE00042');
  await click('Pix'); await click('Gerar Pix');
  expect(paymentService.createPayment).toHaveBeenCalledWith(order.id, expect.objectContaining({ selectedPaymentMethod: 'bank_transfer' }));
  const checkButton = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Já paguei'))!;
  expect(checkButton).toBeTruthy(); await act(async () => checkButton.click());
  expect(paymentService.getPaymentStatus).toHaveBeenCalledWith(order.id);
});
it('boleto uses technical ID, never the visible publicCode', async () => {
  vi.mocked(paymentService.createPayment).mockResolvedValue({ external_resource_url: 'https://example.invalid/boleto' });
  await payment(); await click('Boleto'); await click('Gerar boleto');
  expect(paymentService.createPayment).toHaveBeenCalledWith(order.id, expect.objectContaining({ selectedPaymentMethod: 'ticket' }));
  expect(host.textContent).toContain('3DCOMMERCE00042');
});
