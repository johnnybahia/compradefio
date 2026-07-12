# Análise da Planilha — "CEARÁ ESTOQUE ONLINE COMPRAS CONSULTA"

> Documento gerado a partir da engenharia reversa do arquivo `.xlsx` exportado do Google Sheets. Objetivo: servir de base de entendimento antes de reescrever o sistema em Apps Script (`.gs`) + HTML.

## 1. Visão geral

É um sistema de **controle de estoque de matéria-prima (fios/cores) e compras**, usado por uma fábrica (unidade "CEARÁ" de um grupo maior, dado o nome de outras planilhas referenciadas). O arquivo não é autossuficiente: ele é um **satélite** que consome dados de **outras 3 planilhas Google** via `IMPORTRANGE`, e centraliza:

- Consulta de saldo de estoque (somente leitura, espelhado de uma planilha "mestre").
- Lançamento de movimentações (entrada/saída) por usuários, que geram uma fila de "compras necessárias".
- Controle de embarques (chegada de fio comprado).
- Pedidos de fio cruzando dados de produção (planilha externa) com o cadastro interno de cores, via uma tabela de associação com normalização de texto (regex).
- Login simples por usuário/senha (aba oculta).
- Histórico/backup de tudo.

O sistema claramente já tem um **Apps Script por trás no Google Sheets original** (menus, triggers `onEdit`, provavelmente um Web App HTML para lançar movimentações) — isso não vem no `.xlsx` exportado, então meu entendimento aqui é 100% inferido pelas fórmulas, abas ocultas, validações de dados e formatações condicionais.

## 2. As 3 planilhas externas (IMPORTRANGE)

| ID da planilha | Aba referenciada | Usada em | Papel provável |
|---|---|---|---|
| `1KFPHMy_2o0sgZ8helXa5IhpAEKmmK1elGdRsqPAbeGM` | `ESTOQUE` | aba `ESTOQUE` (A:K) | **Planilha mestre de estoque** — fonte da verdade, alimentada por outro sistema/planilha |
| `1Z4ZSq2XenY4Rp6EJyKhqvGpYrb0917GSCXtqVveUNX8` | `PRIORIDADES DE FIO` | aba `PEDIDO DE FIO` (K:L) | Lista de prioridade de cores a embarcar |
| `1GtYG4Ahy5XJyJjE37S27u8RyELdRkct8nDAVGIBRI-w` | `RELATÓRIO GERAL DA PRODUÇÃO` | aba `PEDIDO DE FIO` (M,N,R) | Relatório de produção com descrição do item pedido pelo cliente, cliente e data |

Somente as abas **`ESTOQUE`** e **`PEDIDO DE FIO`** têm fórmulas `IMPORTRANGE` ativas. Todas as outras abas contêm **valores estáticos** (colados por script, não fórmulas vivas) — sinal de que um Apps Script roda periodicamente/via evento para materializar dados.

## 3. Fluxo de dados (ciclo de vida de um lançamento)

```
Planilha MESTRE (externa)
        │ IMPORTRANGE
        ▼
   aba ESTOQUE  ──ARRAYFORMULA──▶  aba ESPELHO DO ESTOQUE (versão enxuta p/ dropdowns)
        │
        │ (usuário lança entrada/saída via formulário/Web App)
        ▼
   aba RELATORIO  (fila: PRODUTO, NOVO SALDO, OBS, DATA/HORA, STATUS)
        │  STATUS = ESTOQUE (ok) ou URGENTE (saldo baixo/negativo)
        ▼
   aba COMPRA DE FIO  (=RELATORIO + VALOR EMBARQUES + estoque mínimo)
        │
        │ quando resolvido/processado
        ▼
   aba HISTORICO  (arquivo permanente, 27k+ linhas)

   aba EMBARQUES  (registra chegada de fio comprado, cruza com COMPRA DE FIO.VALOR EMBARQUES)
   aba BACKUP_ESTOQUE  (cópia de segurança de todas as movimentações, 64k+ linhas)
```

Em paralelo, **PEDIDO DE FIO** é um subsistema separado: cruza pedidos de clientes (vindos da planilha de produção) com os códigos internos de cor (via `ASSOCIAÇÃO`) para gerar uma lista priorizada do que precisa ser comprado/embarcado antes do prazo do cliente.

## 4. Abas — detalhamento

| Aba | Visibilidade | Linhas | Papel |
|---|---|---|---|
| `ESTOQUE` | visível | 62.500 | Espelho ao vivo (IMPORTRANGE) do razão de estoque da planilha mestre |
| `ESPELHO DO ESTOQUE` | oculta | 80.500 | Versão enxuta de ESTOQUE (Item, Data, Saldo, Saída, Obs) — alimenta listas/dropdowns |
| `RELATORIO` | visível | ~87 | Fila de lançamentos recentes (entrada de dados do usuário) |
| `COMPRA DE FIO` | visível | 1.000 | Deriva de RELATORIO; decide o que comprar (status URGENTE) |
| `FILTRO POR PERIODO` | visível | 15.304 | Consulta filtrável do razão por período/grupo |
| `EMBARQUES` | visível | 1.721 | Controle de chegada de fio comprado (cor, peso, nº embarque, situação) |
| `PEDIDO DE FIO` | visível | 7.492 | Motor de casamento pedido-de-cliente ↔ cadastro interno de cor |
| `ASSOCIAÇÃO` | visível | 9.266 | Tabela de tradução entre nomenclaturas de cor (interna vs. produção) |
| `USUÁRIOS` | **oculta** | 2 | Login: usuário + senha (texto puro) |
| `LISTAGEM DE ESTOQUE` | oculta | 1.000 | Último saldo por item |
| `CORES DESATUALIZADAS` | oculta | 6.634 | Lançamentos antigos/legados fora do padrão atual |
| `RELATORIO POR GRUPO DE ITEM` | oculta | 18 | Saldo agrupado por categoria (BORRACHAS, etc.) |
| `TOTAL EMBARCADO` | oculta | 1.000 | Total já embarcado por código de cadastro |
| `CONSUMO 3 MESES` | oculta | 1.000 | Consumo dos últimos 3 meses + lotes de tingimento |
| `BASE TINGIMENTO` | oculta | 1.000 | Receita de tingimento (gramas de corante por tipo de fio) |
| `HISTORICO` | oculta | 27.022 | Arquivo permanente de tudo que passou por COMPRA DE FIO |
| `BACKUP_ESTOQUE` | oculta | 64.943 | Cópia de segurança bruta de todas as movimentações de estoque |
| `DADOS` | oculta | 50.500 | Listas de apoio: usuários, grupos de matéria-prima, unidades de medida, observações padrão |

### 4.1 `ESTOQUE` (o razão / ledger)
Colunas: `Item | Data | NF | Obs | Saldo Anterior | Entrada | Saída | Saldo | Alterado Em | Alterado Por`

Cada coluna é uma fórmula do tipo:
```
=IFERROR(ARRAYFORMULA(IMPORTRANGE("URL_MESTRE", "'ESTOQUE'!B1:B")), "Item")
```
Ou seja: puxa a coluna inteira da planilha mestre; se der erro (link quebrado/sem permissão), mostra só o cabeçalho. Isso é a estrutura **razão contábil de estoque**: cada linha é um movimento (entrada ou saída) com saldo anterior e saldo resultante.

### 4.2 `ESPELHO DO ESTOQUE`
```
A2 = ARRAYFORMULA(ESTOQUE!B2:B80500)   " Item
B2 = ARRAYFORMULA(ESTOQUE!C2:C80500)   " Data
C2 = ARRAYFORMULA(ESTOQUE!I2:I80500)   " Saldo
D2 = ARRAYFORMULA(ESTOQUE!H2:H80500)   " Saída
E2 = ARRAYFORMULA(ESTOQUE!E2:E80500)   " Obs
```
Usada como fonte de **listas suspensas** (ex.: coluna `A` alimenta o dropdown de cores em `EMBARQUES!A2:A1721`).

### 4.3 `RELATORIO` → `COMPRA DE FIO`
`RELATORIO`: `PRODUTO | NOVO SALDO | OBS | DATA/HORA | STATUS` (STATUS = `ESTOQUE` ou `URGENTE`, provavelmente calculado por script comparando saldo com um mínimo).

`COMPRA DE FIO` referencia diretamente as 4 primeiras colunas de `RELATORIO` (`=RELATORIO!A2` etc.) e adiciona:
- `E`: status (URGENTE/ESTOQUE)
- `F`: "VALOR RELATORIO" (= mesmo valor de B)
- `G`: "VALOR EMBARQUES" (inicia em 0 — provavelmente somado via script com o que já está a caminho em `EMBARQUES`)
- `K1`: rótulo "estoque mínimo" (coluna reservada para valor mínimo por item, vazia no snapshot)
- `J1 = 21` (constante solta — possível parâmetro, ex. dias de lead time ou limiar)

### 4.4 `PEDIDO DE FIO` — o mais complexo (motor de casamento de pedidos)
Estrutura de "formulário" no topo (nº do pedido, data) e depois uma tabela gigante (linha 5 = cabeçalho, dados a partir da linha 6/7):

| Col | Conteúdo | Fórmula/origem |
|---|---|---|
| A | Código da cor (digitado) | manual |
| B | Quantidade | manual |
| D,E | Cliente / Referência | `LET(...)` cascata de busca via `ASSOCIAÇÃO` |
| F | Data limite de embarque | manual/lookup |
| G | Data de entrega do pedido | manual |
| H | Data da solicitação | manual |
| I | Dias restantes | `=IF(F="","",F-$I$1)` (`$I$1=TODAY()`) |
| J | Prioridade | `XLOOKUP` casando os 4 primeiros dígitos do código com a lista de prioridades |
| K,L | Cor / Prioridade (import) | `IMPORTRANGE` de `PRIORIDADES DE FIO` |
| M,N | Descrição do pedido / Cliente | `QUERY(IMPORTRANGE(...RELATÓRIO GERAL DA PRODUÇÃO...))` |
| O | **Código de cor normalizado** | `MAP + LAMBDA + REGEXEXTRACT/REGEXMATCH` — extrai o código de cor de um texto livre tipo `"ATAC. M60126 6MM ALPINA COR 2453"`, tratando casos especiais: RECICLADO, REFLEX, HELANCA, `/PET`, `/B` (brilhante), sufixo `/P`, `/1` etc. |
| P,Q | Código de cadastro casado | `LET` gigante que tenta casar o valor de O contra as colunas B, C, D, E de `ASSOCIAÇÃO` em cascata (primeira que bater vence), senão `"Sem cadastro"` |
| R | Data sistema | `QUERY(IMPORTRANGE(...))` |

**Em resumo, a coluna O + P/Q implementam um pequeno "parser" de texto livre → código de cor padronizado → busca em tabela de associação → código interno de cadastro.** Esse é o núcleo de lógica de negócio mais sofisticado da planilha e é o principal candidato a virar uma função `.gs` bem testada (ao invés de uma fórmula LET gigante).

Regras de formatação condicional confirmam a lógica:
- `F6:F49`: destaca quando `I < 7` (menos de 7 dias para o prazo → urgente).
- `A6:A49`: destaca quando o código não aparece em nenhum `O` (cor pedida sem cadastro associado).
- `A1:A49`: destaca duplicidade de código.
- `E,F,G,Q`: destaca células com texto `"ATUALIZAR"` (sinalizando que precisam de atenção manual).

### 4.5 `ASSOCIAÇÃO` — tabela de tradução de nomenclatura de cores
```
A: código "cru" (ex.: "4662/PET", "5481/PET")
B: fórmula IF() aninhada gigante que normaliza A para o padrão interno
   (ex.: "4662/PET" → "4662/1 RECICLADO"), tratando casos:
     - códigos especiais fixos (101→"101 LAVADO", 102→"102 LAVADO", 2000→"2000 LAVADO 30-2")
     - sufixo "/PET" ou "/1PET" → "/1 RECICLADO"
     - "PONTEIRA" / "PERSONALIZADA" → separa em duas partes com SPLIT
     - código de 4 dígitos começando com "2" → adiciona " 30-2"
     - "/B" + "COR" → "BRILHANTE" + código
     - remove zeros à esquerda
C,D,E: colunas de mapeamento manual adicional (poucas linhas preenchidas — exceções)
H: lista de códigos únicos vindos de PEDIDO DE FIO!O (via UNIQUE), com o código de
   cadastro correspondente digitado manualmente ao lado — é assim que a associação
   é "aprendida"/mantida por um humano quando aparece uma cor nova.
```
Formatação condicional em `H1:H9266` destaca códigos que ainda **não têm** entrada correspondente em `A` — ou seja, sinaliza pro usuário "essa cor apareceu num pedido mas eu ainda não sei traduzir ela, cadastre".

### 4.6 `USUÁRIOS` (login)
Apenas 1 usuário no snapshot: `JOHNNY / 9196`. Estrutura simples de 2 colunas (usuário, senha em texto puro — **sem hashing**). Isso deve virar autenticação de verdade (ex. Google account / PropertiesService com hash) no projeto novo.

### 4.7 `EMBARQUES`
`CORES | PESO | EMBARQUE | DATA | SITUAÇÃO`. Validação de dados: `SITUAÇÃO` é lista fixa (`"CHEGOU"`, possivelmente mais opções digitadas depois), `CORES` é dropdown alimentado por `ESPELHO DO ESTOQUE!A`.

### 4.8 `BASE TINGIMENTO` / `CONSUMO 3 MESES`
Tabela de receita de corante (gramas por componente, 8 variações "Nº 01".."Nº 08") por tipo de fio (Poliéster, Brilhante, Reciclado/PET) e consumo dos últimos 3 meses por item cruzado com até 8 lotes de tingimento. Não tem fórmulas vivas no snapshot — dados estáticos, provavelmente inseridos/atualizados por script ou manualmente.

### 4.9 `HISTORICO` e `BACKUP_ESTOQUE`
Arquivos sem fórmulas — só valores. `HISTORICO` (8 colunas, sem cabeçalho) parece ser o destino de linhas de `COMPRA DE FIO` uma vez resolvidas (mesma estrutura: código, saldo, obs, data, status, valor relatório, valor embarques, timestamp de processamento). `BACKUP_ESTOQUE` é uma cópia bruta e mais completa do razão (com uma coluna extra "Grupo"), provavelmente um snapshot diário/periódico de segurança.

## 5. Padrões de fórmula identificados (para replicar em Apps Script)

1. **Espelhamento entre planilhas**: `IFERROR(ARRAYFORMULA(IMPORTRANGE(url, aba!range)), default)` — no `.gs` vira leitura direta via `SpreadsheetApp.openByUrl(...).getRange(...).getValues()`, com cache (`CacheService`) para não estourar cota.
2. **Saldo corrente (ledger)**: Saldo = Saldo Anterior + Entrada − Saída, uma linha por movimento (não é um "estoque atual" simples, é um livro razão completo).
3. **Fila → arquivo**: `RELATORIO`/`COMPRA DE FIO` como fila de trabalho, `HISTORICO` como arquivo — padrão clássico de "inbox processado". Isso mapeia bem para um fluxo de Web App: `doPost` grava em `RELATORIO`; uma function de "processar" move para `HISTORICO`.
4. **Motor de matching texto-livre → código**: `REGEXEXTRACT`/`REGEXMATCH`/`SPLIT` em cascata (`ASSOCIAÇÃO.B`, `PEDIDO DE FIO.O`) — isso é o candidato número 1 para virar uma função JS pura e testável (`normalizarCorProducao(texto)`), muito mais legível que a fórmula atual.
5. **Lookup em cascata com fallback**: `LET` + `MAP` + `LAMBDA` tentando colunas B→C→D→E até achar, senão `"Sem cadastro"` — em `.gs` vira um loop simples com `Array.find`.
6. **Alertas por formatação condicional**: "urgente" (prazo < 7 dias), "sem cadastro" (falta associação), "duplicado", "ATUALIZAR" — essas regras de negócio hoje são só *visuais*; no sistema novo devem virar **validações/flags explícitas no backend**, não só cor de célula.

## 6. Pontos em aberto (preciso confirmar com você antes do desenho do projeto)

- O Apps Script original (menus, `onEdit`, Web App/HTML de lançamento) **não está no `.xlsx`** — preciso que você descreva (ou cole o código, se tiver) o que já existe hoje, ou vamos desenhar do zero baseado só nas fórmulas?
- Quem edita o quê: só a "planilha mestre" de `ESTOQUE` é editável, e esta aqui é 100% derivada/consulta? Ou usuários também editam diretamente `RELATORIO`/`COMPRA DE FIO`/`EMBARQUES` aqui?
- O login (`USUÁRIOS`) é usado por um Web App HTML hoje, ou é só uma tabela de referência?
- Qual é a real fonte de "estoque mínimo" (coluna vazia em `COMPRA DE FIO.K`) — é para digitar manualmente por item, ou existe em outro lugar?
- `PEDIDO DE FIO` × `ASSOCIAÇÃO`: o cadastro de novas cores (coluna H) é 100% manual hoje? Faz parte do fluxo que você quer automatizar?

---

Com isso documentado, me conta a dinâmica de uso (quem lança o quê, quando, em que ordem) e o que você imagina para o app novo (Web App HTML substituindo o quê, triggers automáticos, etc.) que a gente desenha o projeto `.gs` + `.html`.
