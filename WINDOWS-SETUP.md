# 🚀 Catalog CRM - Guia de Execução (Windows)

## ⚡ Forma Rápida (Recomendada)

### Passo 1: Iniciar o Banco de Dados

Abra o **Command Prompt** (cmd.exe) e execute:

```
d:\Projetos\catalog-crm\start-db.bat
```

Isso iniciará PostgreSQL e PgAdmin via Docker. **Deixe rodando** neste terminal.

### Passo 2: Instalar Dependências e Popular Dados

Abra **outro Command Prompt** e execute:

```
d:\Projetos\catalog-crm\setup.bat
```

Isso irá:
- ✅ Instalar npm packages
- ✅ Executar migrations do banco
- ✅ Popular dados iniciais (seed)

Pressione qualquer tecla quando terminar.

### Passo 3: Iniciar Backend

Abra **um terceiro Command Prompt** e execute:

```
d:\Projetos\catalog-crm\run-backend.bat
```

Você deve ver:

```
[Nest] 12345 - 09/01/2026, 14:30:00     LOG [NestFactory] Starting Nest application...
[Nest] 12345 - 09/01/2026, 14:30:02     LOG [InstanceLoader] PrismaModule dependencies...
[Nest] 12345 - 09/01/2026, 14:30:03     LOG Nest application successfully started on port 3000
```

**Deixe rodando** neste terminal.

### Passo 4: Iniciar Frontend

Abra **um quarto Command Prompt** e execute:

```
d:\Projetos\catalog-crm\run-frontend.bat
```

Você deve ver:

```
VITE v5.4.21  ready in 150 ms

➜  Local:   http://localhost:5173/
➜  press h to show help
```

### Passo 5: Acessar a Aplicação

Abra seu navegador e acesse:

```
http://localhost:5173
```

**Login:**
- 👤 Usuário: `admin`
- 🔐 Senha: `admin`

---

## 📍 URLs Importantes Enquanto Estiver Rodando

| Serviço | URL | Acesso |
|---------|-----|--------|
| **Frontend** | http://localhost:5173 | Aplicação React |
| **Backend API** | http://localhost:3000 | API REST |
| **PgAdmin** | http://localhost:5050 | Gerenciador DB |
| **Prisma Studio** | http://localhost:5555 | Visualizador de dados |

---

## 🐳 Docker - Gerenciar Banco de Dados

### Ver status dos containers
```bash
docker-compose ps
```

### Parar tudo
```bash
docker-compose down
```

### Resetar banco de dados (⚠️ DELETA TUDO)
```bash
docker-compose down -v
docker-compose up -d
```

---

## 🔧 Troubleshooting

### ❌ "Docker não está disponível"
- Instale Docker Desktop: https://www.docker.com/products/docker-desktop
- Reinicie o computador após instalar

### ❌ "Porta 3000 já está em uso"
```bash
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### ❌ "npm não é reconhecido"
- Reinstale Node.js: https://nodejs.org/
- Reinicie o Command Prompt

### ❌ "Erro de conexão com banco"
- Verifique se `start-db.bat` está rodando
- Aguarde 5 segundos para o PostgreSQL iniciar
- Execute `setup.bat` novamente

---

## 📝 Forma Manual (Sem Scripts)

Se preferir fazer tudo manualmente:

```bash
REM Terminal 1: Banco de dados
docker-compose up -d

REM Terminal 2: Setup
cd backend
npm run prisma:migrate
npm run seed

REM Terminal 3: Backend
cd backend
npm run dev

REM Terminal 4: Frontend
cd frontend
npm run dev
```

---

## 🎯 Fluxo de Desenvolvimento

Enquanto o sistema está rodando:

1. **Editar código** - Alterações são aplicadas automaticamente (hot reload)
2. **Testar API** - Use o dashboard ou ferramentas como Postman
3. **Visualizar dados** - Acesse http://localhost:5050 (PgAdmin)
4. **Debugar** - Verifique console do navegador (F12) e logs dos terminais

---

## 🛑 Como Parar Tudo

1. **Frontend**: Pressione `Ctrl+C` no terminal do `run-frontend.bat`
2. **Backend**: Pressione `Ctrl+C` no terminal do `run-backend.bat`
3. **Banco**: Execute `docker-compose down` ou pressione `Ctrl+C` em `start-db.bat`

---

**Problemas?** Verifique os logs em cada terminal para mais detalhes do erro.
