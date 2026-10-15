# Projeto Marfim · Relatório de Tingimento (Google Apps Script)

O web app está em `app/` (os `.gs`/`.html` da raiz são do projeto antigo de
estoque). Decisões e pendências em `app/NOTAS.md`; visão geral em `app/README.md`.

## Regra obrigatória: versão a cada atualização

Toda alteração no programa (`app/`) **muda a versão**, no mesmo commit:

1. Subir `CONFIG.VERSAO` e `CONFIG.VERSAO_DATA` em `app/Config.gs`.
   - correção/ajuste pequeno → 3º número (1.0.0 → 1.0.1)
   - funcionalidade nova ou regra alterada → 2º número (1.0.1 → 1.1.0)
   - mudança grande de estrutura → 1º número (1.1.0 → 2.0.0)
2. Acrescentar a linha no "Histórico de versões" de `app/NOTAS.md` (mais nova em cima).
3. Dizer ao usuário, na resposta, qual é a nova versão.

A versão aparece numa faixa logo acima do programa (`Index.html`, vinda de
`doGet` em `Codigo.gs`) — é como o usuário confere que a versão certa está
rodando. Não remover nem esconder essa faixa.
