-- Custo no item da venda + agendamento de relatorios.
--
-- 1. `SaleItem.unitCost` — snapshot do custo do produto no momento da venda.
--    Sem ele o CMV de ontem era recalculado com o custo de hoje: qualquer
--    reprecificacao de fornecedor mexia retroativamente na margem de um periodo
--    ja fechado. Fica NULL nas vendas antigas (nao ha como saber o custo que
--    valia naquele dia) e nos produtos sem custo cadastrado; quem le informa a
--    cobertura em vez de fingir precisao.
ALTER TABLE "SaleItem" ADD COLUMN "unitCost" DECIMAL(12,2);

-- 2. Agendamento de relatorios. O canal REGISTRO nao envia nada: grava a
--    entrega na trilha. E o padrao ate a loja configurar e-mail ou WhatsApp de
--    verdade, e mantem o agendamento exercitavel sem credencial de terceiro.
CREATE TYPE "ReportFrequency" AS ENUM ('DIARIO', 'SEMANAL', 'MENSAL');
CREATE TYPE "ReportChannel" AS ENUM ('REGISTRO', 'EMAIL', 'WHATSAPP');
CREATE TYPE "ReportDeliveryStatus" AS ENUM ('ENVIADO', 'FALHOU');

CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" "ReportFrequency" NOT NULL,
    "hour" INTEGER NOT NULL,
    "weekday" INTEGER,
    "monthday" INTEGER,
    "channel" "ReportChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- A entrega e a evidencia de que dado sensivel saiu do sistema. Por isso ela
-- NAO cai junto com o agendamento: a FK e SET NULL, e o nome e o relatorio
-- ficam gravados na propria linha para ela continuar legivel sozinha.
CREATE TABLE "ReportDelivery" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT,
    "scheduleName" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ReportDeliveryStatus" NOT NULL,
    "channel" "ReportChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "periodFrom" TEXT NOT NULL,
    "periodTo" TEXT NOT NULL,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "ReportDelivery_pkey" PRIMARY KEY ("id")
);

-- O runner varre exatamente por (active, nextRunAt): sem o indice a varredura
-- de minuto em minuto viraria seq scan na tabela de agendamentos.
CREATE INDEX "ReportSchedule_active_nextRunAt_idx" ON "ReportSchedule"("active", "nextRunAt");
CREATE INDEX "ReportDelivery_scheduleId_runAt_idx" ON "ReportDelivery"("scheduleId", "runAt");

ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportDelivery" ADD CONSTRAINT "ReportDelivery_scheduleId_fkey"
    FOREIGN KEY ("scheduleId") REFERENCES "ReportSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
