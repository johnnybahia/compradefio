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

## 4. O que falta decidir antes de ligar o sistema na Bahia

1. Preciso do **ID (ou link) da planilha Google real** da Bahia — o `.xlsx`
   que temos é só uma exportação estática; para o Web App funcionar preciso
   configurar `SPREADSHEET_ID` apontando pro arquivo Google Sheets de
   verdade (não dá pra usar o `.xlsx` como banco).
2. O **`codigo.gs` antigo (menu "GESTÃO DO ESTOQUE") ainda está rodando**
   nessa planilha da Bahia hoje? Se sim, seus lançamentos de estoque
   continuam sendo feitos por ele — o Web App novo vai só **ler** a mesma
   aba `ESTOQUE`, sem conflito, mas convém confirmar se dá pra deixar os
   dois coexistindo por um tempo (transição) ou se a ideia é já substituir
   o menu antigo pelo Web App na Bahia também.
3. **Um único projeto Apps Script servindo as duas unidades** (mesmo código,
   dois `SPREADSHEET_ID`/duas implantações) **ou um projeto separado** por
   unidade (cópia)? Recomendo um só projeto com config por unidade — menos
   código para manter — mas confirmo com você antes de mexer.
4. Quem serão os usuários (master/tingimento/almoxarifado1/almoxarifado2)
   da Bahia — mesmas pessoas do Ceará ou uma equipe própria?

## 5. Conclusão

A planilha da Bahia **tem todos os elementos de dados** que o sistema
precisa (estoque, associação de cores, pedidos de fio, base de tingimento,
embarques) — a estrutura é a mesma família da planilha que já usamos para
construir `app/`. O único item que **bloqueia** de fato é o cabeçalho de
`ESTOQUE` (nomes de coluna diferentes do Ceará), fácil de resolver no
código. Fora isso, é sobretudo trabalho de configuração (ID da planilha
real, usuários, e-mails, texto "Bahia" em vez de "Ceará"), não de
reconstrução do sistema.
