import { existsSync } from 'node:fs';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL as string),
});

const hash = (plain: string) => bcrypt.hashSync(plain, 10);

async function main() {
  await prisma.cashMovement.deleteMany();
  await prisma.fiscalDocument.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.cashSession.deleteMany();
  await prisma.stockItem.deleteMany();
  await prisma.product.deleteMany();
  await prisma.taxGroup.deleteMany();
  await prisma.category.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();
  await prisma.storeSettings.deleteMany();
  await prisma.license.deleteMany();

  await prisma.user.createMany({
    data: [
      {
        username: 'admin',
        passwordHash: hash('admin'),
        name: 'Administrador',
        role: 'ADMIN',
      },
      {
        username: 'gerente',
        passwordHash: hash('gerente'),
        name: 'Gerente da Loja',
        role: 'GERENTE',
      },
      {
        username: 'operador',
        passwordHash: hash('operador'),
        name: 'Operador de Caixa',
        role: 'OPERADOR',
      },
    ],
  });

  await prisma.storeSettings.create({
    data: {
      legalName: 'Loja Demonstracao LTDA',
      tradeName: 'Loja Demo',
      cnpj: '00.000.000/0001-00',
      ie: 'ISENTO',
      taxRegime: 'SIMPLES_NACIONAL',
      addressStreet: 'Rua das Flores',
      addressNumber: '100',
      addressDistrict: 'Centro',
      addressCity: 'Sarzedo',
      addressState: 'MG',
      addressZip: '32450-000',
      phone: '(31) 3000-0000',
      nfceEnvironment: 'homologacao',
    },
  });

  const [bebidas, mercearia, limpeza] = await Promise.all([
    prisma.category.create({ data: { name: 'Bebidas' } }),
    prisma.category.create({ data: { name: 'Mercearia' } }),
    prisma.category.create({ data: { name: 'Limpeza' } }),
  ]);

  const taxGroup = await prisma.taxGroup.create({
    data: {
      name: 'Revenda - Simples Nacional (CSOSN 102)',
      origin: 0,
      cfop: '5102',
      csosn: '102',
      description: 'Mercadoria para revenda, sem permissao de credito de ICMS.',
    },
  });

  const products = [
    { sku: 'BEB-001', barcode: '7891000100001', name: 'Refrigerante Cola 2L', unit: 'UN', price: '9.90', cost: '6.20', categoryId: bebidas.id, qty: 48 },
    { sku: 'BEB-002', barcode: '7891000100002', name: 'Agua Mineral 500ml', unit: 'UN', price: '2.50', cost: '1.10', categoryId: bebidas.id, qty: 120 },
    { sku: 'BEB-003', barcode: '7891000100003', name: 'Suco de Laranja 1L', unit: 'UN', price: '7.49', cost: '4.80', categoryId: bebidas.id, qty: 30 },
    { sku: 'MER-001', barcode: '7891000200001', name: 'Arroz Branco 5kg', unit: 'UN', price: '27.90', cost: '21.00', categoryId: mercearia.id, qty: 25 },
    { sku: 'MER-002', barcode: '7891000200002', name: 'Feijao Carioca 1kg', unit: 'UN', price: '8.99', cost: '6.30', categoryId: mercearia.id, qty: 40 },
    { sku: 'MER-003', barcode: '7891000200003', name: 'Cafe Torrado 500g', unit: 'UN', price: '15.90', cost: '11.50', categoryId: mercearia.id, qty: 6 },
    { sku: 'MER-004', barcode: null, name: 'Banana Prata (kg)', unit: 'KG', price: '5.99', cost: '3.20', categoryId: mercearia.id, qty: 35 },
    { sku: 'LIM-001', barcode: '7891000300001', name: 'Detergente Neutro 500ml', unit: 'UN', price: '3.29', cost: '1.90', categoryId: limpeza.id, qty: 60 },
    { sku: 'LIM-002', barcode: '7891000300002', name: 'Sabao em Po 1kg', unit: 'UN', price: '12.49', cost: '8.70', categoryId: limpeza.id, qty: 4 },
    { sku: 'LIM-003', barcode: '7891000300003', name: 'Agua Sanitaria 1L', unit: 'UN', price: '4.19', cost: '2.40', categoryId: limpeza.id, qty: 50 },
  ];

  for (const p of products) {
    await prisma.product.create({
      data: {
        sku: p.sku,
        barcode: p.barcode,
        name: p.name,
        unit: p.unit,
        price: p.price,
        cost: p.cost,
        categoryId: p.categoryId,
        taxGroupId: taxGroup.id,
        stock: {
          create: { quantity: p.qty.toString(), minQuantity: '10' },
        },
      },
    });
  }

  await prisma.customer.createMany({
    data: [
      { name: 'Maria Souza', document: '123.456.789-00', phone: '(31) 98888-1111' },
      { name: 'Joao Pereira', phone: '(31) 97777-2222' },
      { name: 'Consumidor Final' },
    ],
  });

  await prisma.license.create({
    data: { key: 'DEMO-LICENSE-2026-001', customer: 'Loja Demo', active: true },
  });

  console.log('Seed B2C concluido:');
  console.log('  usuarios : admin/admin, gerente/gerente, operador/operador');
  console.log(`  produtos : ${products.length}  |  categorias: 3`);
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
