import './ImportProductsModal.css';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, type ImportResult } from '../lib/api-client';
import { Modal } from './Modal';

const TEMPLATE = [
  'sku;nome;preço;custo;categoria;unidade;estoque;estoque mínimo;código de barras',
  'CAF-001;Café Torrado 500g;15,90;9,50;Mercearia;UN;40;10;7890000000010',
  'BEB-010;Suco de Uva 1L;8,49;5,20;Bebidas;UN;25;6;',
].join('\r\n');

const MAX_BYTES = 6 * 1024 * 1024;

export function ImportProductsModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [createCategories, setCreateCategories] = useState(true);
  const [readError, setReadError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useMutation<ImportResult, Error>({
    mutationFn: () => productsApi.importCsv(csv, createCategories),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });

  const pickFile = async (file: File | undefined) => {
    setReadError('');
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setReadError(`Arquivo muito grande (${Math.round(file.size / 1024)} KB). Máximo 6 MB.`);
      return;
    }
    try {
      setCsv(await file.text());
      setFileName(file.name);
    } catch {
      setReadError('Não foi possível ler o arquivo.');
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  const templateHref =
    'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + TEMPLATE + '\r\n');

  const result = run.data;
  const lineCount = csv.trim() ? csv.trim().split(/\r?\n/).length - 1 : 0;

  return (
    <Modal
      title="Importar produtos por CSV"
      onClose={onClose}
      width={860}
      footer={
        result ? (
          <button className="primary-button" onClick={onClose}>
            Concluir
          </button>
        ) : (
          <>
            <a className="mini-button spacer" href={templateHref} download="modelo-produtos.csv">
              Baixar modelo
            </a>
            <button className="ghost-button" onClick={onClose}>
              Cancelar
            </button>
            <button
              className="primary-button"
              disabled={lineCount === 0 || run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending ? 'Importando…' : `Importar ${lineCount || ''} linha${lineCount === 1 ? '' : 's'}`}
            </button>
          </>
        )
      }
    >
      {result ? (
        <>
          <div className="import-summary">
            <span className="tag tag-success">{result.created} criados</span>
            <span className="tag">{result.updated} atualizados</span>
            {result.errors > 0 ? (
              <span className="tag tag-warning">{result.errors} com erro</span>
            ) : null}
            <span className="muted">de {result.total} linhas</span>
          </div>
          <div className="table-scroll" style={{ marginTop: 14, maxHeight: 380 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Linha</th>
                  <th>SKU</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td>
                      <small>{r.sku || '—'}</small>
                    </td>
                    <td>
                      <span
                        className={`tag ${
                          r.action === 'error'
                            ? 'tag-warning'
                            : r.action === 'created'
                              ? 'tag-success'
                              : ''
                        }`}
                      >
                        {r.action === 'created'
                          ? 'Criado'
                          : r.action === 'updated'
                            ? 'Atualizado'
                            : 'Erro'}
                      </span>
                      {r.message ? <small style={{ marginLeft: 8 }}>{r.message}</small> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          {run.error ? (
            <div className="error-message">{run.error.message}</div>
          ) : null}

          <p className="muted" style={{ marginBottom: 12 }}>
            Colunas: <strong>sku</strong>, <strong>nome</strong> e <strong>preço</strong> são
            obrigatórias. Opcionais: custo, categoria, unidade, estoque, estoque mínimo, código
            de barras, descrição. Separador <code>;</code> ou <code>,</code>. Preço aceita
            <code> 12,90</code> ou <code>12.90</code>. SKU já existente é atualizado — o saldo de
            estoque não é sobrescrito na reimportação.
          </p>

          <div className="logo-actions" style={{ marginBottom: 12 }}>
            <label className="file-button">
              {fileName || 'Escolher arquivo .csv'}
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={createCategories}
                onChange={(e) => setCreateCategories(e.target.checked)}
              />
              Criar categorias novas automaticamente
            </label>
          </div>
          {readError ? <div className="error-message">{readError}</div> : null}

          <textarea
            className="field-input"
            style={{ minHeight: 200, fontFamily: 'ui-monospace, monospace', fontSize: '0.82rem' }}
            placeholder="Cole o conteúdo do CSV aqui, ou escolha um arquivo acima…"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
          <small>{lineCount} linha(s) de dados.</small>
        </>
      )}
    </Modal>
  );
}
