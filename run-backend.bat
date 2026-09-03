@echo off
REM Script para rodar o backend em modo desenvolvimento

cd /d "d:\Projetos\catalog-crm\backend"

echo ===================================================
echo   BACKEND - Catalog CRM
echo ===================================================
echo.
echo Iniciando NestJS em http://localhost:3000
echo Pressione Ctrl+C para parar
echo.

call npm run dev
