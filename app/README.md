# Marfim · Gestão de Compras — Web App

Sistema web (Google Apps Script + HTML) em que **a planilha funciona apenas
como banco de dados** e todo o acesso é feito por esta aplicação, com login
próprio e telas por papel de usuário.

## Papéis

| Papel | Acesso |
|---|---|
| `master` | Tudo: análise de compra, tingimento, embarques, recebimento, usuários |
| `tingimento` | Painel de tingimento (marcar quantidade tingida e "OK") |
| `almoxarifado1` | Confirmar embarque |
| `almoxarifado2` | Confirmar recebimento (kg reais que chegaram) |

## Unidades (múltiplas empresas/planilhas no mesmo Web App)

Um único projeto/implantação atende mais de uma unidade (ex.: Ceará e
Bahia) — cada uma com sua própria planilha, configurada em
`CONFIG.UNIDADES` (`app/Config.gs`). O usuário troca de unidade num clique
no seletor que aparece no topo da tela (some sozinho se só houver uma
unidade configurada). A troca não recarrega a página: pega um token novo já
com a unidade escolhida e a partir daí toda leitura/gravação usa a
planilha certa (ver `_definirUnidadeAtiva` em `app/Db.gs`).

A aba `USUARIOS` (login) é **global** — as mesmas credenciais valem para
todas as unidades — e mora sempre na planilha da unidade padrão, a menos
que `SPREADSHEET_ID_AUTH` aponte para outra. Já a lista de e-mails de envio
da compra e a numeração do Pedido de Fio são **por unidade** (cada uma com
sua própria Propriedade do script).

## Arquitetura

- **Web App** publicado com *Executar como: eu (dono)* e *Acesso: qualquer
  pessoa* → os usuários entram pela URL e **não precisam de conta Google nem de
  acesso à planilha**. O script lê/grava a planilha com a permissão do dono.
- **Login próprio** (aba `USUARIOS`): senha nunca é gravada em texto (salt +
  SHA-256 iterado). A sessão é um **token assinado (HMAC)**, guardado no
  navegador e verificado no servidor a cada ação.
- **Interface** de página única: `Index.html` (estrutura), `Estilos.html` (CSS)
  e `App.html` (JavaScript). O logo da Marfim é uma URL externa fixa
  (`CONFIG.LOGO_URL`, em `Config.gs`) — usada na tela (splash/login/topo) e
  nos e-mails; se o link cair, a imagem só se oculta (`onerror`), nunca
  quebra a página. `Logo.html` é um arquivo antigo (base64), sem uso.

## Aviso de "Relatório atualizado"

A tela **Relatório** é a referência da lista de itens. Sempre que ela muda —
item novo, quantidade/data alterada, baixa (embarque) ou item que saiu — todo
mundo que estiver com o sistema aberto recebe uma **caixa de aviso com um
único botão OK**, dizendo *o que* mudou.

Como funciona (ver `_revisaoRelatorio` em `Consultas.gs`):

1. A cada leitura do relatório o servidor calcula uma "impressão digital" do
   conteúdo (item + quantidade + data limite + status + volumes + observação +
   nº do pedido).
2. Mudou a impressão digital → a **revisão** avança de número e fica gravado
   *o que* mudou (itens novos, alterados e que saíram), na aba **oculta**
   `RELATORIO_REVISAO` — uma por unidade, criada sozinha na primeira vez.
3. O navegador de cada usuário pergunta a revisão atual a cada minuto
   (`verificarRevisaoRelatorio`, com cache curto no servidor pra não reler a
   planilha a cada pergunta) e também ao voltar para a aba do navegador. Se a
   revisão for maior que a última que **aquele** usuário confirmou (guardada
   no `localStorage`, por unidade), abre o aviso.
4. Além da caixa: **bolinha vermelha** no menu *Relatório* e, dentro da tela,
   uma faixa com a data da última atualização e selos **novo** / **alterado**
   nos itens que mudaram — quem chegou depois ainda enxerga o que mudou.

O primeiro acesso de cada navegador só memoriza a revisão (não avisa de
mudança que aconteceu antes de o usuário chegar). Abrir a tela Relatório
também confirma a revisão — quem está olhando a lista atualizada não precisa
do aviso.

## Confirmação de embarque (PDF do e-mail)

O PDF anexo ao e-mail de confirmação traz, além dos itens por tipo de fio e do
consumo de fio crú:

- **Total de volumes** dos fios (e o subtotal de volumes em cada tipo de fio).
- No consumo de fio crú, o **preço unitário da NF** de onde o fio saiu (ao
  lado de fornecedor e data). NF sem preço cadastrado aparece como `—`.

A tela **Confirmar Embarque** mostra o **próximo número de embarque** desta
unidade (com um link "ajustar" para master/almoxarifado 1 corrigirem a
sequência na mão, sem mexer nas Propriedades do script). A **taxa de mão de
obra** é salva assim que o campo perde o foco — não depende de a confirmação
do embarque dar certo. Os textos explicativos da tela ficam atrás de um link
"Como funciona" (fechado por padrão).
- **Total de mão de obra** com a **base do cálculo** ao lado
  (`R$ x,xx/kg × N kg tingidos`), pra conferir o valor sem refazer a conta.
- **MALOTE**, quando marcado na tela Confirmar Embarque (caixa logo abaixo da
  observação geral):
  - *Segue com os fios* — o PDF só informa que há malote; nada muda nos números.
  - *Nota separada* — o PDF ganha o campo **Volumes do malote**, que é a base
    para emitir a nota só dele. Esses volumes **não** entram no total de
    volumes dos fios. Sem quantidade informada, a confirmação é barrada (tela
    e servidor).

## Arquivos

| Arquivo | Papel |
|---|---|
| `appsscript.json` | Manifesto (Web App, fuso, escopos) |
| `Config.gs` | Configuração central (IDs, papéis, nomes de abas) |
| `Db.gs` | Camada de acesso à planilha |
| `Auth.gs` | Login, hash de senha, token de sessão, cadastro de usuários |
| `Codigo.gs` | `doGet` (entrada do Web App) e utilitários |
| `Analise.gs` | Motor da análise de compra (esqueleto, lógica a preencher) |
| `Index.html` / `Estilos.html` / `App.html` | Interface |

## Como publicar (primeira vez)

1. Crie um projeto em <https://script.google.com> e adicione os arquivos desta
   pasta (ou use `clasp` com `rootDir` apontando para `app/`).
2. Em **Configurações do projeto → Propriedades do script**, crie:
   - `SPREADSHEET_ID_CEARA` = ID da planilha do Ceará.
   - `SPREADSHEET_ID_BAHIA` = ID da planilha da Bahia.
     (Compatibilidade: se só existir a antiga `SPREADSHEET_ID`, ela vale
     como planilha da unidade padrão até as novas serem configuradas.)
   - *(opcional)* `SPREADSHEET_ID_AUTH` = planilha onde a aba `USUARIOS`
     deve morar, se quiser separá-la das planilhas de dados (por padrão usa
     a planilha da unidade padrão).
   - *(opcional)* `SENHA_MASTER_INICIAL` = senha inicial do master.
3. Rode a função **`inicializarSistema`** uma vez (menu Executar). Ela cria a
   aba `USUARIOS` e o usuário **`master`** (a senha aparece no log de execução;
   troque-a depois).
4. **Implantar → Nova implantação → App da Web**
   (*Executar como: eu*, *Acesso: qualquer pessoa*). Copie a URL e distribua.
5. Rode **`diagnostico`** (menu Executar) para conferir, unidade por
   unidade, se a planilha está configurada e as abas certas existem.

## Estado atual (nesta etapa)

- ✅ Tela de **login** profissional com o logo, validando contra a aba
  `USUARIOS`.
- ✅ **Sessão** por token e **menu por papel** (cada usuário só vê o que é seu).
- ✅ Tela **Análise de Compra** (master): seletor de data de corte e a
  **estrutura** da relação de compra — incluindo a coluna **Descrição**, que
  identifica cada item para o usuário (equivalente à coluna E da aba
  `PEDIDO DE FIO`).
- ⏳ A **lógica** da análise (`Analise.gs`) está com o contrato de dados pronto,
  aguardando as regras para ser preenchida.

## O que preciso de você para a próxima etapa

1. **Fio cru**: estrutura das notas fiscais de fio cru — o que cada NF traz
   (tipo de fio, cor/lote, peso/kg, data) e como o saldo é acompanhado.
2. **Tabela de tingimento**: como ler a proporção (a partir do consumo de 3
   meses) para definir quanto pedir por quantidade de tingimento disponível.
3. **Pedido em aberto**: onde ficam os pedidos já solicitados e como identificar
   o que ainda não chegou, para pedir só a diferença.
4. **Descrição do item**: confirmar a fonte do texto de referência de cada
   código (a lista que as fórmulas geravam via `ASSOCIAÇÃO` / `PEDIDO DE FIO`).
5. **Fluxo de status**: os estados exatos entre solicitado → tingido/OK →
   embarque confirmado (almox 1) → recebido com kg reais (almox 2).
