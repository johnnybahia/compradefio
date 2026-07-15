> **Atualização:** as decisões abaixo já foram tomadas e implementadas —
> ver "Status" no fim de cada seção. Resumo: o código passou a aceitar os
> dois padrões de cabeçalho de `ESTOQUE` (nada muda na planilha real), e o
> sistema virou **multiunidade**: um seletor no topo da tela troca entre
> Ceará e Bahia (ou qualquer unidade em `CONFIG.UNIDADES`) sem precisar de
> uma implantação separada por empresa. Detalhes em `app/README.md`.

# Análise da planilha "BAHIA ESTOQUE ONLINE CONSULTAS" para replicar o projeto `app/`

> Objetivo: usar o Web App já construído em `app/` (hoje desenhado a partir da
> planilha "Marfim Ceará") também para a **Marfim Bahia**, usando
> `BAHIA ESTOQUE ONLINE CONSULTAS.xlsx` como retrato da base de dados real
> dessa unidade. Este documento compara as duas bases e lista o que falta
> para o sistema rodar sobre a Bahia.

## 0. O que este arquivo realmente é

Pelas abas e pelo formato dos dados, o `.xlsx` da Bahia **não é** a mesma
espécie de planilha "CONSULTA" (só leitura, via `IMPORTRANGE`) que
analisamos para o Ceará em `ANALISE_PLANILHA.md`. A aba `ESTOQUE` aqui tem
**valores digitados diretamente** (sem fórmula), no formato exato que
`codigo.gs` (a versão antiga, ligada à planilha, descrita em
`ANALISE_CODIGO_GS.md`) escreve a cada lançamento: `GRUPO, DESCRIÇÃO
(=item), DATA LANÇAMENTO, NOTA FISCAL/PEDIDO, OBSERVAÇÕES, ESTOQUE ATUAL,
ENTRADA, SAIDA, SALDO DE ESTOQUE, ALTERAÇÕES, USUÁRIO, OK`. Ou seja: **esta
é a planilha operacional de verdade da Bahia** — provavelmente ainda com o
menu antigo (`GESTÃO DO ESTOQUE`) rodando nela hoje —, não uma cópia
derivada. Isso é uma boa notícia: os dados são reais e não é preciso
reconstruir nada a partir de fórmulas `IMPORTRANGE`.

## 1. Comparação aba a aba com o que `app/` espera

| Aba | Existe na Bahia? | Compatível com `app/` hoje? | Observação |
|---|---|---|---|
| `ESTOQUE` | ✅ | ❌ **bloqueia** | Cabeçalho diferente do Ceará (ver §2) |
| `ASSOCIAÇÃO` | ✅ | ✅ | Colunas A–E no formato esperado (código cru → normalizado) |
| `PEDIDO DE FIO` | ✅ | ✅ | Colunas K/L (código/data limite) e M/N/O (descrição/cliente/código normalizado) no lugar certo — validei com amostras da própria planilha |
| `BASE TINGIMENTO` | ✅ | ✅ | **Idêntica** à do Ceará (mesmas máquinas/capacidades) |
| `EMBARQUES` | ✅ | ✅ | `CORES/PESO/EMBARQUE/DATA/SITUAÇÃO` nas 5 primeiras colunas (tem uma coluna extra `EM VIAJEM`, ignorada) |
| `USUARIOS` | ❌ (não existe) | não bloqueia | `app/Auth.gs` cria essa aba sozinho (`inicializarSistema`) — não usa a antiga `DADOS`/login embutido |
| `MAPA_EMBARQUE` | ❌ | não bloqueia | Criada sozinha no primeiro embarque lido por PDF |
| `PENDENCIAS_EMBARQUE` | ❌ | não bloqueia | Criada sozinha na primeira análise |
| `RELACAO_COMPRA` | ❌ | não bloqueia | Criada sozinha na primeira geração de compra |
| `RELATORIO`, `COMPRA`, `COMPRA DE FIO`, `HISTORICO`, `BACKUP_ESTOQUE`, `TOTAL EMBARCADO`, `CORES DESATUALIZADAS`, `CONSUMO 3 MESES`, `FILTRO POR PERIODO`, `LISTAGEM DE ESTOQUE`, `RELATORIO POR GRUPO DE ITEM`, `DADOS`, `ESPELHO DO ESTOQUE` | ✅ (várias) | **não usadas** por `app/` | Pertencem só ao sistema antigo (menu Sheets); o Web App novo recalcula tudo direto de `ESTOQUE` e não depende delas |

## 2. O bloqueio real: cabeçalho de `ESTOQUE`

`app/Analise.gs` (`_lerEstoque`) procura as colunas de `ESTOQUE` **pelo nome
exato** (normalizado, mas sem tolerância a sinônimo): `item`, `data`,
`entrada`, `saida`, `saldo`, `obs`. Isso bate com o Ceará:

```
Ceará : Item | Data | NF | Obs | Saldo Anterior | Entrada | Saída | Saldo | Alterado Em | Alterado Por
Bahia : GRUPO | DESCRIÇÃO | DATA LANÇAMENTO | NOTA FISCAL/PEDIDO | OBSERVAÇÕES | ESTOQUE ATUAL | ENTRADA | SAIDA | SALDO DE ESTOQUE | ALTERAÇÕES | USUÁRIO | OK
```

Como nenhum cabeçalho da Bahia é igual a "Item", "Data" ou "Saldo", a função
**lança erro** (`"A aba ESTOQUE precisa ter as colunas Item, Data e Saldo no
cabeçalho."`) e a Análise de Compra — o motor central do sistema — não roda.
As outras 33 mil linhas de dados estão no lugar certo (coluna B = código do
item, coluna C = data, coluna G/H = entrada/saída, coluna I = saldo); só o
texto do cabeçalho não bate.

Duas formas de resolver, sem mexer nas ~33 mil linhas de dados:

1. **Renomear só a linha 1** de `ESTOQUE` na planilha real da Bahia para o
   padrão do Ceará (`Item`, `Data`, `NF`, `Obs`, `Saldo Anterior`, `Entrada`,
   `Saída`, `Saldo`, `Alterado Em`, `Alterado Por` — mantendo `GRUPO` e `OK`
   como colunas extras, que o código ignora). Mais rápido, zero mudança de
   código, mas **só funciona se nenhum script antigo (`codigo.gs`) devolver o
   cabeçalho ao normal** — por isso preciso confirmar se esse script antigo
   ainda está ativo nessa planilha (ver §4, pergunta 2).
2. **Ensinar o código a aceitar os dois padrões de nome** (ex.: aceitar
   `descrição` como sinônimo de `item`, `data lançamento` como sinônimo de
   `data`, `saldo de estoque` como sinônimo de `saldo`). Mais robusto — o
   mesmo código serve Ceará e Bahia sem tocar na planilha de ninguém — mas é
   mudança de código que precisa ser testada.

**Recomendo a opção 2** (deixar o código tolerante a sinônimos), porque a
planilha de produção é do cliente e uma edição de cabeçalho pode ser
revertida por proteção/script antigo sem eu perceber; ajustar o código é
reversível e fica versionado aqui.

**Status: implementado (opção 2).** `_lerEstoque` (`Analise.gs`) e as
funções de conciliação de embarque (`Embarque.gs`) agora usam
`_colPorNomes` (`Db.gs`), que tenta cada convenção de nome em ordem —
`item`/`descricao`, `data`/`data lancamento`, `saldo`/`saldo de estoque`,
`obs`/`observacoes`, `nf`/`nota fiscal/pedido`. Nada muda na planilha real;
o `codigo.gs` antigo pode continuar rodando na Bahia sem conflito, já que
o Web App só lê `ESTOQUE`.

## 3. Único ponto de "branding" fixo no código (Ceará hardcoded)

`app/Consultas.gs` (linhas ~116–145) e `app/App.html` (linha ~662) têm o
texto **"MARFIM CEARÁ"** cravado no nome do PDF, no assunto do e-mail e no
título da impressão do Pedido de Fio. Para a Bahia, isso precisa virar uma
configuração (`CONFIG.UNIDADE` ou similar) em vez de texto fixo — assim o
mesmo projeto/código serve as duas unidades (ou uma cópia do projeto) sem
precisar caçar strings espalhadas.

Tudo o mais que já é "por unidade" **já está pronto para ser diferente por
planilha**, porque vive em Propriedades do Script (não no código):
`SPREADSHEET_ID`, lista de e-mails de destino da compra (`EMAILS_COMPRA`),
número inicial do Pedido de Fio (`NUMERO_PEDIDO_FIO`), senha inicial do
master.

**Status: implementado.** O texto agora vem de `CONFIG.getUnidadeInfo(...)`
(unidade ativa da sessão) em vez de "CEARÁ" fixo — tanto no PDF/e-mail
(`Consultas.gs`) quanto na impressão (`App.html`). `EMAILS_COMPRA` e
`NUMERO_PEDIDO_FIO` também passaram a ser por unidade (sufixo `_CEARA`/
`_BAHIA` na Propriedade do script), já que as duas passaram a rodar no
mesmo projeto.

## 4. Arquitetura implementada: um Web App, várias unidades

Em vez de "um projeto por unidade" ou "renomear planilha", ficou definido
(ver conversa) que o **mesmo Web App atende as duas empresas**, com um
seletor de unidade no topo da tela — clicar troca qual planilha o sistema
usa, sem sair do sistema nem recarregar a página.

- `CONFIG.UNIDADES` (`Config.gs`) lista as unidades (id, rótulo, nome da
  Propriedade do script com o ID da planilha). Adicionar uma nova unidade
  no futuro é só acrescentar uma entrada aqui + configurar a Propriedade.
- A sessão (token assinado) carrega qual unidade está ativa. Trocar de
  unidade (`trocarUnidade`) emite um token novo; todas as leituras/gravações
  daquela chamada em diante usam a planilha certa (`_definirUnidadeAtiva`
  em `Db.gs`, acionado por `exigirSessao`).
- A aba `USUARIOS` (login) é **global** — não muda com a unidade — para as
  mesmas credenciais servirem os dois times, a menos que se prefira
  separar (`SPREADSHEET_ID_AUTH`).

O que ainda falta, puramente operacional (não é mais decisão de arquitetura):

1. **ID real da planilha Google da Bahia** — o `.xlsx` analisado aqui é só
   uma exportação estática; para o Web App funcionar preciso do ID (ou
   link) do arquivo Google Sheets de verdade, para configurar
   `SPREADSHEET_ID_BAHIA` nas Propriedades do script.
2. Confirmado: o `codigo.gs` antigo (menu "GESTÃO DO ESTOQUE") continua
   ativo na planilha da Bahia — sem conflito, já que o Web App só lê
   `ESTOQUE` (não grava nela).
3. Quem serão os usuários (master/tingimento/almoxarifado1/almoxarifado2)
   que vão operar a unidade Bahia — mesmas pessoas do Ceará ou equipe própria
   (cadastro via `salvarUsuario`/tela de usuários)?

## 5. Conclusão

A planilha da Bahia **tem todos os elementos de dados** que o sistema
precisa (estoque, associação de cores, pedidos de fio, base de tingimento,
embarques) — a estrutura é a mesma família da planilha que já usamos para
construir `app/`. O bloqueio de cabeçalho de `ESTOQUE` e o texto "Ceará"
fixo já foram resolvidos no código (§2 e §3); o sistema agora é
multiunidade por desenho (§4). O que resta é puramente operacional: o ID
real da planilha Google da Bahia e a definição dos usuários que vão operar
essa unidade.
