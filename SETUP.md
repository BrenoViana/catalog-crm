# Guia de Setup Inicial

## 1. Preparar Ambiente

### Clonar o repositório
```bash
git clone <repository-url>
cd catalog-crm
```

### Instalar dependências
```bash
npm install
```

### Configurar variáveis de ambiente
```bash
cp .env.example .env
# Editar .env com seus valores reais
```

## 2. Configurar Banco de Dados

### PostgreSQL (local)
```bash
# Iniciar PostgreSQL (Docker recomendado)
docker run -d \
  --name postgres-crm \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=catalog_crm \
  -p 5432:5432 \
  postgres:16

# Ou instalar localmente
# macOS: brew install postgresql
# Windows: https://www.postgresql.org/download/windows/
# Linux: sudo apt-get install postgresql
```

### Executar migrations
```bash
npm run backend:dev
# Na primeira execução, Prisma cria o schema automaticamente
```

## 3. Rodar em Desenvolvimento

### Terminal 1 - Backend
```bash
npm run backend:dev
# Será executado em http://localhost:3000
```

### Terminal 2 - Frontend
```bash
npm run frontend:dev
# Será executado em http://localhost:5173
```

### Browser
Acesse `http://localhost:5173/login` e faça login com:
- **Usuário**: admin
- **Senha**: admin

## 4. Estrutura de Diretórios

```
catalog-crm/
├── backend/
│   ├── src/
│   │   ├── app.module.ts       # Módulo raiz
│   │   ├── auth/               # Módulo de autenticação
│   │   ├── users/              # Gerenciamento de usuários
│   │   ├── customers/          # Cadastro de clientes
│   │   ├── sellers/            # Perfil de vendedores
│   │   ├── opportunities/      # Pipeline de oportunidades
│   │   ├── sales/              # Registro de vendas
│   │   ├── dashboard/          # Métricas executivas
│   │   ├── license/            # Validação de licenças
│   │   └── main.ts             # Arquivo de entrada
│   ├── prisma/
│   │   └── schema.prisma       # Definição do banco de dados
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/
│   ├── src/
│   │   ├── pages/              # Componentes de página
│   │   ├── components/         # Componentes reutilizáveis
│   │   ├── store/              # Estado global (Zustand)
│   │   ├── App.tsx             # Componente raiz
│   │   ├── main.tsx            # Arquivo de entrada
│   │   └── styles.css          # Estilos globais
│   ├── package.json
│   └── vite.config.ts
│
├── .env.example                # Template de variáveis de ambiente
├── .gitignore
├── package.json                # Root workspace
└── README.md
```

## 5. Comandos Úteis

### Desenvolvimento
```bash
npm run dev                     # Roda backend + frontend juntos
npm run backend:dev            # Apenas backend
npm run frontend:dev           # Apenas frontend
```

### Build
```bash
npm run build                  # Build de ambos
npm run backend:build          # Apenas backend
npm run frontend:build         # Apenas frontend
```

### Produção
```bash
npm run start                  # Inicia backend em produção
npm run frontend:preview       # Preview do build frontend
```

## 6. Troubleshooting

### Porta 3000 em uso
```bash
# Alterar no backend/.env ou usar:
PORT=3001 npm run backend:dev
```

### Porta 5173 em uso (Vite)
```bash
# Vite automaticamente tenta outra porta
# Ou configure em frontend/vite.config.ts
```

### Erro de conexão com PostgreSQL
```bash
# Verificar .env DATABASE_URL
# Verificar se PostgreSQL está rodando
# Executar: docker ps (se usar Docker)
```

## 7. Próximos Passos

1. Completar a integração do frontend com a API do backend
2. Implementar seed de dados de exemplo
3. Adicionar testes unitários (Jest)
4. Configurar CI/CD (GitHub Actions)
5. Deploy em ambiente staging

---

Para dúvidas ou problemas, consulte a documentação completa em [README.md](./README.md)
