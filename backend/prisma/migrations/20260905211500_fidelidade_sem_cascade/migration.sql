-- Apagar um cliente nao pode apagar o razao do cashback dele.
--
-- LoyaltyAccount pendurada em Customer com ON DELETE CASCADE fazia
-- DELETE /customers/:id levar junto a conta e todos os LoyaltyEntry — ou seja,
-- a evidencia de saldo criado e consumido. Como `customers.manage` pertence
-- tambem ao OPERADOR, bastava apagar o cliente para sumir com o rastro de um
-- ajuste indevido (SEC-063). RESTRICT obriga a resolver o saldo antes.
ALTER TABLE "LoyaltyAccount" DROP CONSTRAINT "LoyaltyAccount_customerId_fkey";
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
