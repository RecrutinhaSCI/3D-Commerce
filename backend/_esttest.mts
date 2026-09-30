import { PrismaClient } from '@prisma/client';
import { applyStockForOrder } from './src/modules/orders/orders.service';
const prisma = new PrismaClient();
async function mkOrder(pid: string, name: string) {
  return prisma.order.create({ data: {
    customerName: 'C', customerEmail: 't@t.com', customerPhone: '1', addressSnapshot: {},
    subtotal: 5, total: 5, paymentMethod: 'PIX',
    items: { create: [{ productId: pid, productName: name, quantity: 1, unitPrice: 5, total: 5 }] },
  }});
}
async function main() {
  const p = await prisma.product.findFirst({ where: { active: true } });
  if (!p) throw new Error('no product');
  const orig = p.stock;
  await prisma.product.update({ where: { id: p.id }, data: { stock: 1 } }); // só 1 em estoque
  const o1 = await mkOrder(p.id, p.name);
  const o2 = await mkOrder(p.id, p.name);
  const [a, b] = await Promise.all([applyStockForOrder(o1.id), applyStockForOrder(o2.id)]); // corrida pela última unidade
  const finalStock = (await prisma.product.findUnique({ where: { id: p.id } }))!.stock;
  const statuses = [a.status, b.status].sort();
  await prisma.order.delete({ where: { id: o1.id } });
  await prisma.order.delete({ where: { id: o2.id } });
  await prisma.product.update({ where: { id: p.id }, data: { stock: orig } }); // restaura estoque original
  console.log(JSON.stringify({ statuses, finalStock, oversoldPrevented: finalStock >= 0 }, null, 2));
  console.log('PASS =', finalStock === 0 && statuses.includes('applied') && statuses.includes('insufficient'));
}
main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
