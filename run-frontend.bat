@echo off
REM Script para rodar o frontend em modo desenvolvimento

cd /d "d:\Projetos\catalog-crm\frontend"

echo ===================================================
echo   FRONTEND - Catalog CRM
echo ===================================================
echo.
echo Iniciando Vite em http://localhost:5173
echo Pressione Ctrl+C para parar
echo.

call npm run dev
