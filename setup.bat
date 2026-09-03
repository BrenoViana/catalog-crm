@echo off
REM Script para inicializar o Catalog CRM

echo.
echo ===================================================
echo   CATALOG CRM - Inicializacao Rapida
echo ===================================================
echo.

REM 1. Instalar dependencias
echo [1/4] Instalando dependencias...
echo.
cd /d "d:\Projetos\catalog-crm"
call npm install

if errorlevel 1 (
    echo ERRO: npm install falhou
    pause
    exit /b 1
)

echo.
echo [2/4] Aguardando PostgreSQL estar pronto...
echo.
timeout /t 3

REM 2. Migrations
echo [3/4] Executando migrations do banco de dados...
echo.
cd /d "d:\Projetos\catalog-crm\backend"
call npm run prisma:migrate -- --skip-generate

if errorlevel 1 (
    echo AVISO: migrations pode precisar de entrada manual
)

echo.
echo [4/4] Populando dados iniciais...
echo.
call npm run seed

if errorlevel 1 (
    echo AVISO: seed pode precisar de entrada manual
)

echo.
echo ===================================================
echo   Inicializacao concluida!
echo ===================================================
echo.
echo Proximos passos:
echo   1. Abra DOIS terminais separados
echo   2. No primeiro terminal, rode:
echo      cd d:\Projetos\catalog-crm
echo      npm run backend:dev
echo.
echo   3. No segundo terminal, rode:
echo      cd d:\Projetos\catalog-crm
echo      npm run frontend:dev
echo.
echo   4. Abra no navegador:
echo      http://localhost:5173/login
echo.
echo   Usuario: admin
echo   Senha: admin
echo.
pause
