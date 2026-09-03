@echo off
REM Script para iniciar o banco de dados com Docker

echo ===================================================
echo   DATABASE - PostgreSQL + PgAdmin
echo ===================================================
echo.

cd /d "d:\Projetos\catalog-crm"

if exist "docker-compose.yml" (
    echo Iniciando PostgreSQL e PgAdmin...
    echo.
    call docker-compose up -d
    
    if errorlevel 1 (
        echo ERRO: Docker nao esta disponivel
        echo Por favor, instale Docker Desktop:
        echo https://www.docker.com/products/docker-desktop
        pause
        exit /b 1
    )
    
    echo.
    echo ===================================================
    echo   PostgreSQL iniciado com sucesso!
    echo ===================================================
    echo.
    echo URLs importantes:
    echo   - PostgreSQL: localhost:5432
    echo   - PgAdmin: http://localhost:5050
    echo   - Usuario: postgres
    echo   - Senha: postgres
    echo.
    echo Aguardando conexao estar pronta...
    timeout /t 5
    
) else (
    echo ERRO: docker-compose.yml nao encontrado
    pause
    exit /b 1
)
