# Análise do `codigo.gs` + Diálogos HTML

> Continuação de `ANALISE_PLANILHA.md`, agora com o código Apps Script (`codigo.gs`) e os 13 arquivos `.html` (Dialogs/Sidebars) que você adicionou ao repositório. Isso mostra o que o sistema **realmente faz hoje** (a planilha só mostrava o resultado das fórmulas; o script mostra a lógica por trás).

## 0. Achado mais importante: este script provavelmente NÃO é da planilha que analisamos antes

O `codigo.gs` sempre opera na **planilha ativa** (`SpreadsheetApp.getActiveSpreadsheet()`), lendo e **escrevendo diretamente** na própria aba `ESTOQUE` (linha nova a cada lançamento, via `processEstoque`). Ele não usa `IMPORTRANGE` em nenhum momento.

Isso contradiz o que vimos no `.xlsx` — lá, a aba `ESTOQUE` era só fórmulas `IMPORTRANGE` puxando de uma planilha "mestre" externa (ID `1KFPHMy...`). Ou seja:

- O `.xlsx` que analisamos primeiro parece ser a exportação da planilha **"CONSULTA"** (só leitura, espelha a mestre).
- Este `codigo.gs` parece pertencer à planilha **mestre de verdade** (ou a uma cópia onde `ESTOQUE` é editável diretamente).

**Preciso que você confirme isso** antes de desenhar o projeto novo: o script que você subiu roda em qual das duas planilhas? Vamos construir o projeto novo para operar direto nessa planilha (deixando a de "consulta" como está, ou fundindo as duas)?

## 1. Menu (`updateMenus`) — o mapa de todas as funcionalidades

```
GESTÃO DO ESTOQUE
├─ Inserir Estoque              → showEstoqueSidebar (sidebar DialogEstoque.html)
├─ Inserir Grupo                → showGrupoDialog (DialogInserirGrupo.html)
├─ Localizar Produto            → localizarProduto (DialogLocalizarProduto.html)
├─ Mostrar Todos                → mostrarTodos
├─ Gerar Relatório              → abrirDialogRelatorioEstoque (DialogRelatorioEstoque.html)
├─ Relatório por Grupo          → abrirDialogRelatorioPorGrupo (DialogRelatorioPorGrupo.html)
├─ Listagem de Estoque          → showListagemEstoqueSidebar (DialogListagemEstoque.html)
├─ Atualizar Compra de Fio e Histórico → atualizarCompraDeFioEHistorico
├─ Atualizar Total Embarcado    → atualizarTotalEmbarcado
├─ Alternar Restauração         → toggleRestore (senha fixa no código: "919633")
├─ Corrigir Datas em Texto      → corrigirDatasEmTexto
├─ Apagar Última Linha          → apagarUltimaLinha
├─ ÚLTIMA LINHA                 → select10RowsBelow
├─ Estoque por Período          → abrirDialogEstoquePorPeriodo (DialogEstoquePorPeriodo.html)
├─ Limpar Filtro                → limparFiltroEstoque
├─ Estoque 3 Meses              → showEstoque3MesesSidebar (DialogEstoque3Meses.html)
└─ Cores Desatualizadas         → showCoresDesatualizadasDialog (DialogCoresDesatualizadas.html)
```

`onOpen()` roda `updateMenus()` + `backupEstoqueData()` + `removeFilterOnOpen()` toda vez que a planilha é aberta.

## 2. O fluxo central: lançar um movimento de estoque

1. Usuário clica **"Inserir Estoque"** → abre a sidebar `DialogEstoque.html` com campos: **Grupo, Produto, NF/Pedido, Cliente/Obs, Entrada, Saída** (com autocomplete vindo de `DADOS` e da própria `ESTOQUE`).
2. Ao digitar o produto, `checkLastRegistration()` chama `getLastRegistration(item, linhaAtual)`, que procura o **último registro desse item na aba `ESPELHO DO ESTOQUE`** e mostra "Última: dd/mm/aaaa | Estoque: X"; se fizer mais de 20 dias, mostra aviso "PRODUTO DESATUALIZADO".
3. Ao enviar, chama `processEstoque(formData)`, que:
   - Busca o saldo anterior do item (mesma lógica do passo 2).
   - Calcula `novoSaldo = saldoAnterior + entrada - saída`.
   - Grava uma linha nova em `ESTOQUE`: `[Grupo, Item, Data(agora), NF, Obs, SaldoAnterior, Entrada, Saída, NovoSaldo, Data(agora), email do usuário ativo]`.
   - Chama `backupEstoqueData()` (copia as últimas 500 linhas de `ESTOQUE` para `BACKUP_ESTOQUE`, que fica oculta).
   - Se o último registro desse item tinha mais de 20 dias, **pinta a linha nova de vermelho** e avisa "PRODUTO DESATUALIZADO" — é assim que nascem as marcações vermelhas que depois alimentam "Cores Desatualizadas".
4. **Identidade do usuário**: quem gravou o lançamento é capturado via `Session.getActiveUser().getEmail()` (conta Google logada), **não** pela aba `USUÁRIOS` (usuário/senha). Isso é um forte indício de que o login manual (`DialogLogin.html`) é resquício de uma versão anterior e não está em uso.

## 3. Proteção contra edição manual (`onEdit` + `BACKUP_ESTOQUE`)

- `onEdit(e)`: se a edição for na aba `EMBARQUES` (colunas A, B ou E) → dispara `atualizarTotalEmbarcado()`.
- Se for na aba `ESTOQUE`: por padrão (`restoreEnabled` ligado), **qualquer edição manual é revertida automaticamente**, usando o valor equivalente salvo em `BACKUP_ESTOQUE` (mesma linha/coluna) e mostra alerta "Edição manual não é permitida. Utilize o sidebar para inserir dados."
- **Alternar Restauração** (`toggleRestore`) pede uma senha (hardcoded `"919633"` no código-fonte — vale a pena migrar isso para algo mais seguro no projeto novo) para desligar essa proteção temporariamente e permitir colar dados manualmente. Quando desligada, `onEdit` chama `normalizarDatasColadas()` para converter datas coladas como texto em datas reais nas colunas C e J.
- `corrigirDatasEmTexto` faz a mesma limpeza de datas-em-texto só que varrendo a aba inteira, sob demanda pelo menu (útil depois de colagens antigas).

## 4. Pipeline de compra: `EMBARQUES` → `TOTAL EMBARCADO` → `COMPRA DE FIO` → `HISTORICO`

- **`atualizarTotalEmbarcado()`**: soma, por item (coluna `CORES` de `EMBARQUES`), o peso de tudo que ainda está a caminho — se `SITUAÇÃO = "chegou"`, **subtrai** (nunca deixa negativo); senão, **soma**. Grava em `TOTAL EMBARCADO` (como texto, `'código`, para não virar data/n° automático).
- **`atualizarCompraDeFio()`**: para cada item já cadastrado na coluna A de `COMPRA DE FIO`, busca o valor mais recente em `RELATORIO` (saldo do último lançamento) + o total pendente em `TOTAL EMBARCADO`, soma os dois, e marca `URGENTE` se a soma for menor que o limite em `COMPRA DE FIO!J1`, senão `ESTOQUE`.
  - *Observação*: no `.xlsx` a coluna A de `COMPRA DE FIO` tinha fórmulas `=RELATORIO!A2` linha a linha; mas essa função trata a coluna A como uma **lista fixa e já existente de códigos** (não recalculada a partir de `RELATORIO`). Vale confirmar com você como essa coluna A é mantida/atualizada na prática hoje.
- **`copyCompraToHistorico()`** / **`atualizarCompraDeFioEHistorico()`**: depois de atualizar, copia o conteúdo de `COMPRA DE FIO` (7 colunas) + timestamp para o fim de `HISTORICO` — o "arquivo" definitivo.

## 5. Relatórios e consultas

| Menu | Função | O que faz |
|---|---|---|
| Gerar Relatório | `gerarRelatorioEstoque(inicio,fim)` | Para cada produto, pega o registro mais recente dentro do período e escreve em `RELATORIO` (com STATUS URGENTE/ESTOQUE conforme `J1`) |
| Relatório por Grupo | `gerarRelatorioPorGrupo(grupo)` | Mesmo que acima, mas filtrando por Grupo (coluna A de `ESTOQUE`) e escrevendo em `RELATORIO POR GRUPO DE ITEM` |
| Listagem de Estoque | `gerarListagemEstoque(formData)` | Usuário digita até 20 itens; para cada um, acha o último saldo/data em `ESTOQUE` e escreve em `LISTAGEM DE ESTOQUE` |
| Estoque por Período | `filtrarEstoquePorPeriodo(inicio,fim)` | Copia linhas de `ESTOQUE` dentro do período para `FILTRO POR PERIODO`, ordenado por data |
| Estoque 3 Meses | `processEstoque3Meses(formData)` | Cola lista de itens; soma consumo dos últimos 3 meses (via `ESPELHO DO ESTOQUE`) e, usando `BASE TINGIMENTO` como referência (por substring no nome do item), sugere os **8 lotes de tingimento mais próximos** do consumo real — grava em `CONSUMO 3 MESES` e devolve uma tabela HTML |
| Cores Desatualizadas | `processCoresDesatualizadas(data)` | Varre `ESTOQUE` procurando linhas com fundo **vermelho** (as marcadas automaticamente por `processEstoque` quando o item estava com +20 dias sem giro) cuja data ≥ informada; pega os 5 registros mais recentes por item e lista em `CORES DESATUALIZADAS` |

## 6. Funcionalidades construídas mas **não conectadas a nenhum menu** (código morto/experimental)

Encontrei várias funções e HTMLs completos que existem no arquivo mas que **nenhum menu ou botão chama** hoje — parecem experimentos de versões anteriores que ficaram no arquivo:

| Feature | Arquivos envolvidos | Situação |
|---|---|---|
| Login por usuário/senha | `DialogLogin.html` | Chama `processLogin(...)`, que **não existe em `codigo.gs`** — recurso incompleto e não usado. Reforça que a aba `USUÁRIOS` está obsoleta. |
| Sidebar de cores (checkboxes) | `SidebarCores.html`, `showCoresSidebar()`, `processCoresFromSidebar()` | Função completa, mas `showCoresSidebar` nunca é chamada por nenhum menu |
| Consulta de Atualização (15/10 itens) | `DialogConsultaAtualizacao.html`, `showConsultaAtualizacaoSidebar()`, `consultaAtualizacao()`, `processConsultaAtualizacoes()`, `processRepeticoesCoresDesatualizadas()` | Três implementações concorrentes e incompatíveis entre si para "achar cores desatualizadas" (cada uma grava em `CORES DESATUALIZADAS` com um layout de colunas diferente!). Nenhuma é chamada pelo menu atual — só a `processCoresDesatualizadas` (seção 5) está ativa. |
| Listagem de Cores Desatualizadas | `DialogListagemCores.html`, `abrirDialogListagemCores()`, `gerarListagemCoresDesatualizadas()` | Completo, funcional, mas não aparece no menu |

**Recomendação para o projeto novo**: decidir, para cada uma dessas, se vira funcionalidade oficial (com um item de menu) ou se é descartada — não vale a pena carregar código morto para a reescrita.

## 7. Outros problemas encontrados que vale corrigir na reescrita

1. **`codigo.gs` está duplicado quase inteiro.** Da linha 8 até ~1263 existe uma primeira versão de praticamente todas as funções; da linha 1264 até ~2406 existe uma **segunda versão** (mais nova) das mesmas funções. Como no Apps Script "a última declaração da função vence", o sistema funciona hoje porque a versão de baixo (mais completa) é a que realmente roda — mas isso é uma armadilha para manutenção (editar a cópia "de cima" não teria efeito nenhum). A função `parseDateBR` aparece **3 vezes**. Isso confirma que o arquivo foi montado colando trechos de conversas/iterações sucessivas sem nunca limpar as versões antigas.
2. **Bug real**: `DialogEstoque.html` chama `google.script.run...getNextRow()` (duas vezes) para preencher o campo oculto `currentRow`, mas **`getNextRow` não existe em `codigo.gs`**. Hoje essa chamada falha silenciosamente (não há `withFailureHandler` nela) — o `currentRow` provavelmente fica sempre vazio/`undefined`, o que pode afetar a checagem de "não considerar a própria linha" dentro de `getLastRegistration`.
3. **Senha fixa no código-fonte** (`"919633"` em `toggleRestore`) — funciona, mas fica visível a qualquer pessoa com acesso ao editor de scripts. No projeto novo dá para usar algo mais robusto (ex.: checar e-mail/grupo do usuário do Google Workspace).
4. **Três versões de "achar cores desatualizadas"** com layouts de coluna diferentes na mesma aba `CORES DESATUALIZADAS` (`Cadastro/Data/Informação`, `Item/Data/Valor/ValorAdicional`, `Produto/Data/ValorExtra`, além da versão ativa que só grava a coluna E) — bom sinal de que essa parte do sistema ainda estava em experimentação.

## 8. Perguntas em aberto (além das já feitas em `ANALISE_PLANILHA.md`)

1. Este `codigo.gs` está hoje anexado (bound) a qual planilha: a "CEARÁ ESTOQUE ONLINE COMPRAS CONSULTA" que já tínhamos, ou a planilha mestre externa (`1KFPHMy...`)?
2. O login por usuário/senha (`USUÁRIOS` + `DialogLogin.html`) é algo que você quer implementar de verdade no projeto novo, ou pode ser descartado (já que hoje quem identifica o usuário é a própria conta Google)?
3. Das 4 funcionalidades "órfãs" da seção 6, alguma delas é usada por você manualmente (rodando pelo editor de Apps Script) e deveria continuar existindo no projeto novo?
4. Sobre `COMPRA DE FIO`: como a coluna A (lista de cadastros/itens a monitorar) é mantida hoje — é digitada manualmente, ou deveria ser gerada a partir de algo (ex.: todos os itens distintos já vistos em `ESTOQUE`)?
5. A senha "919633" do "Alternar Restauração" — quem deveria ter esse poder no projeto novo (só você, ou um grupo de supervisores)?

---

Combinado com `ANALISE_PLANILHA.md`, isso já dá o retrato completo do sistema atual (dados + lógica). Pode me passar a dinâmica de uso agora, junto com as respostas às perguntas acima — aí sim desenhamos juntos a estrutura do projeto novo (arquivos `.gs`, `.html`, e o que vai mudar/melhorar em relação ao atual).
