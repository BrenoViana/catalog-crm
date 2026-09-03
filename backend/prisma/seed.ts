import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Clean up existing data
  await prisma.sale.deleteMany();
  await prisma.opportunity.deleteMany();
  await prisma.seller.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();
  await prisma.license.deleteMany();

  // Create admin user
  const adminUser = await prisma.user.create({
    data: {
      username: 'admin',
      password: 'admin', // In production, this should be hashed
      name: 'Administrador',
      role: 'ADMIN',
    },
  });

  // Create sellers
  const sellers = await Promise.all([
    prisma.seller.create({
      data: {
        name: 'Ana Paula',
        email: 'ana@catalog.com',
        phone: '11 98765-4321',
        role: 'Varejo',
        salesTarget: 90000,
        commissionRate: 6,
      },
    }),
    prisma.seller.create({
      data: {
        name: 'Bruno Silva',
        email: 'bruno@catalog.com',
        phone: '11 98765-4322',
        role: 'Corporativo',
        salesTarget: 110000,
        commissionRate: 7,
      },
    }),
    prisma.seller.create({
      data: {
        name: 'Carla Mendes',
        email: 'carla@catalog.com',
        phone: '11 98765-4323',
        role: 'Atacado',
        salesTarget: 80000,
        commissionRate: 5,
      },
    }),
  ]);

  // Create customers
  const customers = await Promise.all([
    prisma.customer.create({
      data: {
        name: 'Empresa Nova',
        company: 'Empresa Nova LTDA',
        email: 'contato@empresanova.com',
        phone: '11 3456-7890',
        segment: 'Varejo',
        status: 'QUALIFIED',
      },
    }),
    prisma.customer.create({
      data: {
        name: 'Mercado Central',
        company: 'Mercado Central S.A.',
        email: 'contato@mercadocentral.com',
        phone: '11 3456-7891',
        segment: 'Distribuição',
        status: 'PROPOSAL',
      },
    }),
    prisma.customer.create({
      data: {
        name: 'Sky One',
        company: 'Sky One Tech LTDA',
        email: 'contato@skyone.com',
        phone: '11 3456-7892',
        segment: 'Tecnologia',
        status: 'WON',
      },
    }),
  ]);

  // Create opportunities
  const opportunities = await Promise.all([
    prisma.opportunity.create({
      data: {
        title: 'Nova Loja - Equipamentos',
        customerId: customers[0].id,
        sellerId: sellers[0].id,
        stage: 'PROSPECTING',
        amount: 18000,
      },
    }),
    prisma.opportunity.create({
      data: {
        title: 'Mercado Central - Expansão',
        customerId: customers[1].id,
        sellerId: sellers[1].id,
        stage: 'NEGOTIATION',
        amount: 32000,
      },
    }),
    prisma.opportunity.create({
      data: {
        title: 'Sky One - Contrato Anual',
        customerId: customers[2].id,
        sellerId: sellers[2].id,
        stage: 'WON',
        amount: 46000,
      },
    }),
  ]);

  // Create sales
  await Promise.all([
    prisma.sale.create({
      data: {
        opportunityId: opportunities[2].id,
        amount: 46000,
        status: 'PAID',
      },
    }),
    prisma.sale.create({
      data: {
        opportunityId: opportunities[0].id,
        amount: 11400,
        status: 'PENDING',
      },
    }),
    prisma.sale.create({
      data: {
        opportunityId: opportunities[1].id,
        amount: 7900,
        status: 'PENDING',
      },
    }),
  ]);

  // Create license
  await prisma.license.create({
    data: {
      key: 'DEMO-LICENSE-2024-001',
      customer: 'Catalog CRM Demo',
      active: true,
    },
  });

  console.log('✅ Seed completed successfully');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
