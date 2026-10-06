-- CPF do comprador no pedido (só dígitos). Nullable: pedidos antigos ficam sem.
ALTER TABLE "orders" ADD COLUMN "customer_cpf" TEXT;
