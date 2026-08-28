# Notas / pendências do projeto Marfim

Anotações de coisas a acompanhar/melhorar (não são bugs — são decisões e
pendências que valem manter à vista).

## Numeração de embarque (ajuste pontual)

Pedido: o próximo embarque confirmado deve sair como **985 no Ceará** e
**1472 na Bahia**. Isso muda o VALOR INICIAL usado quando a unidade nunca
confirmou nenhum embarque (`NUMERO_EMBARQUE_INICIAL_POR_UNIDADE`, em
`Embarque.gs`) — mas como as duas unidades já confirmaram embarques antes
(a Bahia já ia no nº 4), a Propriedade do script `NUMERO_EMBARQUE_MANUAL_<UNIDADE>`
já existe e tem prioridade sobre esse valor inicial. **É preciso ajustar na
mão uma vez**: tela Confirmar Embarque → link "ajustar" ao lado de "Próximo
número de embarque nesta unidade" → digitar 985 (Ceará) ou 1472 (Bahia) →
Salvar. Depois disso, a sequência segue sozinha (ver `definirProximoNumeroEmbarque`).

## Regra fixa: nada de valor CRU de célula na resposta ao navegador

Toda função chamada pela tela (`chamar('X', ...)` em `App.html`) tem que
devolver só **texto, número, booleano ou null**. Valor cru de célula — `Date`,
erro de fórmula (`#REF!`, `#N/A`, `#VALUE!`), data corrompida — faz a
serialização do `google.script.run` **devolver a resposta inteira nula**, e a
tela morre com *"O servidor não devolveu resposta em X"*. Como isso depende do
conteúdo da planilha, o sintoma aparece **numa unidade só** (foi a Bahia, nas
duas vezes) e engana: parece implantação desatualizada, mas não é.

Use sempre os conversores de `Consultas.gs`:

| Conversor | Para |
|---|---|
| `_textoCelula(v)` | qualquer texto (item, NF, tipo de fio, observação…) |
| `_numeroCelula(v)` | quantidade, saldo, volumes (não-número vira `''`) |
| `_soData(v)` | data (dd/MM/aaaa) |
| `_dataHoraCelula(v)` | carimbo de tempo (dd/MM/aaaa HH:mm) |
| `_itemDeCelula(v)` | código do item (recupera o que virou data: 01/01/5108 → 5108/1) |

Exceção conhecida e proposital: `_lerLotesFioCru` guarda a `NF` **crua**,
porque é esse valor que casa com as baixas/ajustes já gravados na planilha —
ela vira texto só na saída (`listarEstoqueFioCru`, `_consumoCruPorItens`).
Quem repetir esse padrão, marque a linha com `// cru de propósito`.

## Cancelamento / reversão de procedimentos (IMPORTANTE)

**Princípio:** toda ação que gera efeito real (baixa de estoque, envio de
e-mail, gravação que muda saldo) deveria ter um caminho de **cancelar/desfazer**
no próprio sistema — ou, no mínimo, um aviso claro + registro de quem fez e
quando. Hoje isso ainda não está uniforme. Mapa da situação atual:

| Procedimento | O que faz | Dá pra desfazer hoje? |
|---|---|---|
| **Confirmar Embarque** | Baixa fio crú + baixa lista pendente + grava em EMBARQUES + e-mail (PDF) | ✅ **Sim** agora — botão "Cancelar embarque" (por número, no histórico): estorna o crú (baixa compensatória a partir do instantâneo `EMBARQUE_ESTORNO`), devolve os itens à pendência, marca CANCELADO e (opcional) manda e-mail de cancelamento. O e-mail original não volta. Marcando **"era embarque duplicado"**, os itens NÃO voltam à pendência (a mercadoria saiu uma vez só). |
| **Enviar urgência** (Tingimento) | Escreve "URGENTE" na observação + e-mail | ✅ **Sim** agora — botão "limpar urgência" por item (master e Programação) tira o "URGENTE" da observação. O e-mail já enviado não volta. |
| **Enviar Pedido de Fio** (e-mail) | Envia PDF + avança o nº do pedido | E-mail não "desenvia"; não mexe na lista pendente (nada a reverter nos dados). |
| **Gerar compra** (Análise) | Grava/atualiza PENDENCIA_COMPRA | ✅ Dá pra remover item a item ou zerar a lista. |
| **Quantidade Tingida** | Baixa fio crú | ✅ "Corrigir" ajusta pela diferença (credita de volta). |
| **Ajuste de saldo / lote de fio crú** | Ledger append-only | ✅ Novo ajuste compensa; histórico preservado. |

**Feito:**
1. ✅ **Cancelar embarque confirmado** — `cancelarEmbarque` + instantâneo
   `EMBARQUE_ESTORNO` gravado na confirmação. Reverte crú e pendência com
   precisão. Embarque já "chegou" não pode ser cancelado por aqui.
2. ✅ **Limpar urgência** — `limparUrgenciaTingimento`.

## Edição na Confirmar Embarque não aparecia pra outros usuários (resolvido)

Reportado: quando um usuário editava algo na tela **Confirmar Embarque**
(quantidade a confirmar, observação, marcar "completo"), a edição **não
ficava visível** pra mais ninguém — nem pro master. Causa: só o campo
**Volumes** era salvo na hora (`salvarVolumesItem`); os outros três campos
existiam **só no navegador de quem digitou** — em memória, no JavaScript da
página — e só iam pra planilha no momento do clique final em "Confirmar
Embarque". Recarregar a página, ou qualquer outra pessoa abrindo a mesma
tela, via só o valor original (o total já tingido), como se nada tivesse
sido digitado.

**Corrigido:** dois campos novos em `PENDENCIA_COMPRA`
(`EMBARQUE_QTD_RASCUNHO`, `EMBARQUE_OBS_RASCUNHO`) guardam esse rascunho
**compartilhado** — `salvarRascunhoEmbarque` (Consultas.gs) grava assim que
o usuário sai do campo (quantidade) ou desmarca/marca "completo"/edita a
observação, igual já acontecia com Volumes. A tela relê esses campos toda
vez que carrega (`obterListaFioParaTingir`, FioCru.gs) e pré-preenche com o
rascunho, se houver — senão cai no padrão de sempre (o total tingido). As
duas colunas são limpas sozinhas quando o item é confirmado (a linha some) ou
sobra parcial depois de um embarque (`_baixarPendenciaCompraPorEmbarque`,
Embarque.gs — a linha continua mas o rascunho da rodada anterior não faz
mais sentido pro resíduo).

**Limite conhecido:** isso resolve "a edição sumia/não aparecia para
ninguém" — mas não é tempo real. Se dois usuários estiverem com a tela
aberta AO MESMO TEMPO, um só vê a edição do outro ao recarregar a tela (ou
trocar de aba e voltar), não instantaneamente enquanto ambos olham a
mesma tela ao mesmo tempo. Avaliar isso só vale a pena se virar problema de
verdade na prática (duas pessoas mexendo na mesma tela ao mesmo tempo).

## Tipo de fio "congelado" desatualizando a baixa de fio crú (resolvido)

Reportado: item "…/1 RECICLADO" saiu como **"Fio Reflex 2x167/48"** no PDF de
confirmação de embarque, quando a BASE TINGIMENTO já tinha um padrão certo
(`/1 RECICLADO` → "Fio Reflex Reciclado 2x167/48") pra ele. Testado com os
dados reais da BASE TINGIMENTO: o casamento por padrão (mais comprido vence)
**já dava o resultado certo** — o problema não era a planilha.

**Causa:** `PENDENCIA_COMPRA.TIPO_FIO` é um **instantâneo**, gravado uma vez
quando o item foi analisado ("Gerar compra") — nunca mais recalculado depois
disso. Se alguém cadastra um padrão novo/mais específico na BASE TINGIMENTO
DEPOIS que um item já tinha sido analisado, esse item fica pra sempre com o
tipo antigo (errado) até ser reanalisado. `Confirmar Embarque` e
`Quantidade Tingida` liam esse valor gravado — e pior no segundo caso: a
baixa do fio crú saía do lote **errado** (do "Fio Reflex" em vez do "Fio
Reflex Reciclado"), não só o nome no relatório.

**Corrigido:** novo `_tipoFioAtualDoItem` (Tingimento.gs) — sempre prefere o
casamento **ATUAL** contra a BASE TINGIMENTO; só cai no valor gravado em
`PENDENCIA_COMPRA.TIPO_FIO` quando o item não bate com **nada** hoje (ex.:
código atípico). Usado em `_confirmarEmbarqueManualInterno` (Embarque.gs) e
`_tipoFioDoItemPendente` (FioCru.gs, usado por `registrarQuantidadeTingida`
e `corrigirQuantidadeTingida`) — a checagem de "o item ainda está na lista
pendente?" continua existindo, só o VALOR do tipo de fio é que passou a ser
sempre o de hoje.

## "Você não tem permissão para acessar o documento solicitado" (diagnóstico + erro mais claro)

Esse erro é do próprio Google Apps Script (`SpreadsheetApp.openById` recusado)
— acontece quando a conta que roda o sistema (a que fez a implantação do Web
App, "Executar como: eu") **perde acesso** a alguma planilha: ela foi movida
de pasta, teve o compartilhamento removido, ou foi excluída.

**Pega quem não espera:** algumas tabelas são *universais* — moram sempre na
planilha da **unidade padrão** (Ceará), mesmo quando a ação é da **outra**
unidade:

| Tabela | Por quê é universal | Onde mora por padrão |
|---|---|---|
| `USUARIOS` (login) | mesma senha vale nas duas unidades | unidade padrão (ou `SPREADSHEET_ID_AUTH`) |
| `ASSOCIACAO_FIO_CRU` | a nomenclatura de fio é a mesma nas duas empresas | unidade padrão (ou `SPREADSHEET_ID_ASSOCIACAO_FIO_CRU`) |
| `MAPA_FIO_CRU` (aprendizado de NF) | idem | unidade padrão |
| `EQUIVALENCIA_UNIDADES` | precisa ver as duas unidades pra comparar | unidade padrão (ou `SPREADSHEET_ID_EQUIV_UNIDADES`) |

Foi exatamente isso que causou o erro **ao confirmar um embarque da Bahia**:
`_baixarFioCru` → `_resolverTipoFioEstoque` → lê `ASSOCIACAO_FIO_CRU`, que
mora na planilha do **Ceará** — se o acesso a ELA falhar, uma ação inteiramente
da Bahia quebra com um erro que parece não ter nada a ver.

**Corrigido:** `_ss()` (Db.gs) agora captura esse erro e relança com o nome
da planilha que falhou (unidade ativa, ou o rótulo passado por quem chamou —
ex.: *"associação de fio crú (unidade padrão) — lida mesmo confirmando
embarque/tingimento de OUTRA unidade, porque é universal"*), os últimos 8
dígitos do ID, e o que checar. A causa raiz (permissão da planilha em si) só
se corrige no Google Drive — verifique se a conta da implantação ainda é
**editora** das planilhas de `SPREADSHEET_ID_CEARA`/`SPREADSHEET_ID_BAHIA` e
de qualquer uma das universais acima que estiver configurada.

## "Chegada" de embarque casando com NF errada (resolvido)

A Análise de Compra confere sozinha se um embarque pendente já chegou:
procura, na aba ESTOQUE, um lançamento cuja NF **contenha** o número do
embarque. Era literal demais — reportado pelo usuário: embarque nº **983**
aberto, e uma NF **15983512** (que nada tem a ver) foi marcada como
"chegou" só porque "983" aparece no meio dela.

Corrigido em `_nfCasaComEmbarque` (`Embarque.gs`): agora só casa quando o
número do embarque aparece na NF como um **bloco de dígitos separado** —
ladeado por início/fim de texto ou por algo que não é dígito (espaço,
traço...) — nunca embutido dentro de outro número maior. Cobre três casos:
NF **igual** ao número do embarque; NF que **começa** por ele seguida de
algo que não é outro dígito (typo do tipo "983-A"); e NF **composta por
partes separadas por espaço**, tipo "91735 983 06", onde o número do
embarque é uma das partes, em qualquer posição (não precisa ser a
primeira). "9834" ou "15983512" continuam não casando — são outros
números, mesmo com os mesmos dígitos embutidos.

(Ajuste posterior: a versão inicial só casava quando o número do embarque
vinha logo no INÍCIO da NF — não reconhecia o caso de NF composta com
espaço, tipo "91735 983 06", onde "983" está no meio. Generalizado pra
checar bloco de dígitos separado em qualquer posição.)

**Se algum embarque já foi marcado "CHEGOU" errado por essa falha**, é preciso
corrigir na mão: aba `EMBARQUES`, coluna SITUAÇÃO da linha afetada, apagar
"CHEGOU" — a próxima análise volta a contar esse embarque como em viagem.

## Clique duplo na Confirmação de Embarque (resolvido)

Aconteceu de verdade (Bahia, embarques nº 3 e nº 4): o usuário confirmou, não
percebeu que tinha dado certo — o envio leva alguns segundos — e confirmou de
novo. Resultado: dois números de embarque, o mesmo item contado **duas vezes
como "em viagem"**, a mão de obra cobrada em dobro (R$ 3.136,16 × 2) e um
segundo e-mail com o relatório errado (tudo sob "tipo de fio não
identificado", porque os itens já tinham saído da lista pendente).

Três barreiras, nesta ordem:

1. **Tela** — o botão trava no primeiro clique ("Confirmando…") e o modal de
   confirmação só aceita uma resposta (`respondido`), então repique de toque
   não dispara duas vezes.
2. **Trava de execução** (`_travaEmbarque`, LockService) — dois cliques quase
   simultâneos não rodam em paralelo; o segundo espera e cai na barreira 3.
3. **Servidor** (`_conferirEmbarqueDuplicado`) — recusa quando (a) o mesmo
   conjunto item+quantidade foi confirmado há menos de 30 min nesta unidade,
   ou (b) **nenhum** dos itens está mais na lista pendente. A mensagem começa
   com `DUPLICADO:` e a tela oferece "Confirmar mesmo assim" (`confirmarDuplicado`)
   para o caso legítimo de uma segunda remessa igual.

> Observação geral: **e-mail enviado não volta.** O máximo que dá é mandar uma
> mensagem de cancelamento/retificação. Por isso, idealmente, toda ação com
> e-mail confirma antes (já é assim em Embarque e Urgência).

## Item de FIO_CRU_BAIXAS aparecendo como data, ex. "01/01/4313" (resolvido)

Reportado pelo usuário na tela "Histórico de baixas": um item com código tipo
"4313/1" apareceu como **"01/01/4313"**. Mesma causa-raiz de outros bugs já
documentados aqui — o Sheets converte sozinho um código "puro" desses em
`Date` ao gravar, a menos que a coluna esteja travada em texto puro
(`.setNumberFormat('@')`).

Isso já tinha sido resolvido em `PENDENCIA_COMPRA`, mas **não** em
`FIO_CRU_BAIXAS` — e ali o estrago é maior que estético: a coluna ITEM desse
razão é comparada por texto em três lugares para achar as baixas de um item
(`_ajustarBaixaFioCru` — crédito de correção, `_consumoCruPorItens` — tabela
de consumo de fio crú no PDF de confirmação de embarque, `_tingidoPorItem` —
"já tingido" mostrado em várias telas). Um ITEM corrompido em `Date` falha
**silenciosamente** em todas essas comparações: a baixa continua lá, só não é
mais encontrada por quem procura por ela.

Corrigido em `FioCru.gs`:

- `_lerBaixasFioCru()` — wrapper de leitura que reconstrói o ITEM (mesma
  lógica de `_itemDeCelula`, já usada em `PENDENCIA_COMPRA`) antes de qualquer
  uso. Substituiu a leitura direta (`lerRegistros(CONFIG.SHEETS.FIO_CRU_BAIXAS)`)
  em todos os pontos que leem essa aba, incluindo `listarBaixasFioCru` (a
  função por trás da tela do print reportado).
- `_prepararFioCruBaixas()` — abre a aba já travando a coluna ITEM em texto
  puro (mesmo padrão de `_prepararAbaCompra`), usada em todo ponto que grava
  nessa aba (baixa por tingimento, correção de baixa, cancelamento de
  embarque), para não corromper de novo daqui pra frente.

**Baixas já gravadas com o ITEM corrompido continuam corrompidas na planilha**
(a leitura reconstrói na hora de exibir/comparar, mas não reescreve a
célula) — funciona normalmente, só não é "texto puro" se alguém abrir a
planilha direto e olhar a célula.

## Corrigir Volumes/observação na Confirmar Embarque deixava a borda vermelha, sem dizer por quê (resolvido)

Reportado: usuário corrige os volumes de um item direto na tela Confirmar
Embarque (pra consertar um erro digitado antes, sem precisar voltar na
Quantidade Tingida) e o campo fica com a borda vermelha — sem nenhuma
mensagem explicando o motivo.

Duas causas, as duas em `Consultas.gs`:

1. `salvarVolumesItem`, `salvarCampoTingimento` e `salvarRascunhoEmbarque`
   gravam direto em `PENDENCIA_COMPRA` sem antes garantir que a coluna
   existe. Toda outra função que escreve nessa aba já chama
   `_prepararAbaCompra` antes (ver `Embarque.gs`, `Analise.gs`,
   `Migracao.gs`) — essas três eram exceção. Numa planilha mais antiga, de
   antes de `VOLUMES`/`EMBARQUE_QTD_RASCUNHO`/`EMBARQUE_OBS_RASCUNHO`
   entrarem no esquema (e que ainda não passou por nenhuma ação que rode a
   migração), a gravação falhava com "Coluna não encontrada". Corrigido:
   as três agora chamam `_prepararAbaCompra(CONFIG.SHEETS.PENDENCIA_COMPRA)`
   antes de gravar, como as demais.
2. Mesmo com a gravação falhando por outro motivo qualquer (sessão expirada,
   valor inválido etc.), o campo só ficava vermelho — `salvarVolumes`
   (`App.html`) chamava `tratarErro(err)` mas descartava o retorno, então a
   mensagem nunca aparecia em lugar nenhum. Corrigido: a mensagem agora
   aparece no aviso da tela (Quantidade Tingida ou Confirmar Embarque, a que
   estiver ativa) e também como dica ao passar o mouse no campo.

## Relatório: manter a "Data de solicitação" nos itens já embarcados (resolvido)

Pedido do usuário: no Relatório, o item que já foi embarcado (mas ainda não
chegou) perdia a "Data de solicitação" — a coluna ficava em branco assim que
o embarque era lançado.

Causa: essa data vem de `PENDENCIA_COMPRA.GERADO_EM`, e o item **sai** de
`PENDENCIA_COMPRA` na hora do embarque (`_baixarPendenciaCompraPorEmbarque`).
O Relatório continua mostrando o item em viagem lendo direto de `EMBARQUES`
(`_montarLinhasRelatorio`, ramo "faltantes"), mas essa aba nunca guardou a
data — a linha sempre gravava `dataSolicitado: ''`.

Corrigido do mesmo jeito que já resolve o problema idêntico com VOLUMES: a
aba `EMBARQUES` ganhou uma coluna nova, `SOLICITADO_EM` (migração automática
via `_prepararEmbarques`, não afeta abas antigas). `_registrarEmbarqueEDarBaixa`
grava ali o `GERADO_EM` de cada item, lido em `PENDENCIA_COMPRA` **antes** da
baixa acontecer. `_embarquesEmViagemPorItem` passa a expor essa data por
remessa, e o Relatório usa ela em vez do texto vazio.

Efeito colateral encontrado e corrigido: a ordenação do Relatório (pendente
antes de embarcado) usava "tem data de solicitação" como um substituto do
status — só funcionava porque, até aqui, item embarcado NUNCA tinha essa
data. Passou a comparar `status` de verdade (`'pendente'` vs `'embarcado'`),
já que agora as duas listas podem ter a data preenchida.

## "101 LAVADO" sem tipo de fio associado (resolvido)

Reportado: item "101 LAVADO" (101 é código puramente numérico, igual
poliéster) não saía com NENHUM tipo de fio — nem na tela, nem na baixa de
fio crú.

Causa: existe uma reserva pro poliéster (que, diferente dos outros tipos,
não tem sufixo no código — ex.: "5233", "106") usada quando o código do
item é **só números** e nenhum padrão da BASE TINGIMENTO bateu (ver
`_lotesTingimentoDoItem`/`_criarCalculadoraTingimento`, em `Tingimento.gs`).
Essa reserva exigia o código **puramente** numérico — "101 LAVADO" tem a
palavra "LAVADO" a mais, então não é só-número (não cai na reserva) e não
bate em nenhum padrão da BASE TINGIMENTO (não tem "/1", "reciclado" etc.)
— fica sem tipo nenhum.

Corrigido: a reserva do poliéster agora aceita opcionalmente o sufixo
"lavado" (ex.: "101 lavado", "205 lavado"...). Um código numérico
ESPECÍFICO que precise de um tipo PRÓPRIO (ex.: "102 lavado", que já tinha
um caso especial cadastrado — ver `_CASOS_ESPECIAIS_TINGIMENTO`, em
`FioCru.gs`) continua funcionando normalmente: esse caso é checado ANTES
da reserva do poliéster e sempre vence.

## "Prosseguir com a compra" quebrava com erro de nº de colunas (resolvido)

Erro reportado ao clicar em "Prosseguir" na Análise de Estoque:
`O número de colunas nos dados não corresponde ao número de colunas no
intervalo. Os dados têm 17, mas o intervalo tem 19.`

Causa: `RELACAO_COMPRA_HEADERS` (`Analise.gs`) cresceu de 17 para 19 colunas
nesta sessão (ganhou `EMBARQUE_QTD_RASCUNHO` e `EMBARQUE_OBS_RASCUNHO`, do
rascunho compartilhado da Confirmar Embarque), mas `gerarRelacaoDeCompra`
— a função por trás do botão "Prosseguir" — ainda montava cada linha nova
como um array fixo de 17 posições. O `setValues(...)` já usava
`RELACAO_COMPRA_HEADERS.length` (19) pro tamanho do intervalo, então toda
gravação quebrava com esse erro.

Corrigido: a linha passa a incluir as duas colunas novas (vazias — o
rascunho nasce vazio, igual já acontece em `removerItemPendente` e
`_baixarPendenciaCompraPorEmbarque`). Adicionado `teste15.js`, que verifica
genericamente que qualquer linha gravada em `PENDENCIA_COMPRA` tem
exatamente o número de colunas de `RELACAO_COMPRA_HEADERS` — pra pegar essa
classe de erro de novo se o cabeçalho crescer no futuro e algum ponto de
gravação for esquecido.

## "Chegadas a confirmar" — pergunta quando o casamento NF↔embarque não é claro

Pedido do usuário, olhando um caso onde a NF tinha o número do embarque no
meio de um texto composto (ex.: "91735 983 06", separado por espaço): "na
dúvida, abre uma janela perguntando... assim como faz com a Associação."

Até aqui, `_atualizarChegadasEmbarque` só decidia sozinho: ou o casamento
(bloco de dígitos isolado — ver a entrada acima, "'Chegada' de embarque
casando com NF errada") batia e marcava CHEGOU, ou não batia e o caso era
simplesmente ignorado — mesmo quando havia um sinal razoável (número
presente, só não isolado) que merecia uma segunda opinião.

Agora, dois casos que ANTES eram descartados direto viram uma dúvida em vez
de uma decisão silenciosa:
- o número do embarque aparece na NF, mas **embutido** dentro de um número
  maior (não é um bloco isolado — ex.: "983" dentro de "15983512");
- a NF bate (bloco isolado) com **mais de um** embarque pendente ao mesmo
  tempo — não dá pra saber qual dos dois é.

Mesma ideia do painel "Itens novos cadastrados na Associação" (pergunta
quando não tem certeza), mas **sem memorizar a resposta** — pedido explícito
do usuário: "Nenhum desses" só tira da tela naquele momento; se o embarque
continuar em aberto, a mesma dúvida volta a aparecer na próxima vez que a
Análise rodar, até alguém confirmar ou o embarque chegar de outro jeito.

Implementado:
- `_atualizarChegadasEmbarque` (`Embarque.gs`) devolve também `emDuvida:
  [{ item, nf, dataNf, candidatos: [{ numero, linhas }] }]`, sem marcar essas
  linhas sozinho.
- `confirmarChegadaEmbarque` (`Embarque.gs`) — novo endpoint: o master
  escolhe um candidato e confirma; confere DE NOVO, na hora, que a linha
  ainda é daquele embarque (evita marcar errado se a lista mudou entre a
  Análise carregar e o master responder).
- `listarItensParaAnalise` (`Analise.gs`) repassa `chegadasEmDuvida` na
  resposta.
- Painel novo "Chegadas a confirmar" (`App.html`, `renderChegadasDuvida`) —
  mesmo padrão visual/estrutural do painel da Associação: uma linha por
  dúvida, um `<select>` com os candidatos, botões "É este" / "Nenhum
  desses".

Testado com `teste16.js` (servidor: casamento claro continua automático;
os dois gatilhos de dúvida; confirmação: marca certo, recusa se a linha
mudou de embarque) e `teste17.js` (cliente: painel aparece só quando há
dúvida, "Nenhum desses" não chama o servidor, "É este" manda o candidato
certo escolhido no `<select>`) — e regressão completa (`teste.js`–`teste15.js`).

## Cache de itens do estoque não isolado por unidade (resolvido)

Reportado: usuário da BAHIA (unidade certa no login, conferida) vendo o
Relatório com embarques de Bahia e Ceará misturados. Investigando, auditei
todas as funções expostas ao cliente (mais de 60): todas chamam
`exigirSessao` logo no início, que redefine `_unidadeAtivaId` a cada
chamada a partir do token de quem pediu — sem vazamento por aí, cada
requisição resolve a própria unidade do zero. Achei um caso real de
vazamento entre unidades, mas em outro lugar: `listarItensEstoque`
(`Consultas.gs`, autocomplete da tela "Consultar Histórico do Item") usava
uma chave de cache FIXA (`'itensEstoque'`) por 30 minutos — se o Ceará
pedisse primeiro, a Bahia "herdava" a lista de itens do Ceará (e
vice-versa) enquanto esse cache estivesse quente.

Corrigido: a chave agora leva a unidade ativa (`'itensEstoque_' + unidade`,
mesmo padrão já usado em `verificarRevisaoRelatorio`/`_propUnidade`) — cada
unidade tem seu próprio cache, sem interferir uma na outra.

**Isso NÃO explica sozinho o relatório mostrando embarques misturados**
(o `_montarLinhasRelatorio`/`obterRelatorioCompraAtual` não usa cache) —
a suspeita mais forte pra ESSE sintoma específico é as Propriedades do
script `SPREADSHEET_ID_CEARA` e `SPREADSHEET_ID_BAHIA` apontarem pro MESMO
arquivo por engano (aí as duas "unidades" seriam, na prática, a mesma
planilha — todo mundo veria tudo misturado, sempre, não só ao trocar de
unidade). Verificar em: Extensões → Apps Script → Configurações do
projeto → Propriedades do script.

Testado com `teste18.js` (cache isolado por unidade + confirma que o
cache "de verdade" funciona pra reduzir releitura da aba dentro da MESMA
unidade) e regressão completa (`teste.js`–`teste17.js`).

## Destacar itens com saldo baixo na aba Tingimento

Pedido do usuário: achar de cara, na aba Tingimento, os itens com saldo
pendente baixo demais pra valer a pena esperar — pra excluir esses direto
(ver `removerLinhaTingimento`), sem precisar ler a coluna Total linha por
linha.

Novo campo **"Destacar total pendente ≤ (kg)"** na barra de ferramentas
(só pra quem edita — master/tingimento): item com Total (kg) igual ou
abaixo do valor digitado fica **roxo**. Mesmo padrão já usado na Análise
de Estoque ("Destacar saldo ≤ (kg)"), mas implementado sem recriar a
tabela a cada tecla digitada (`reaplicarDestaqueTingimento`, só troca a
classe CSS das linhas) — recriar destruiria o que a pessoa estivesse
digitando nos campos de observação/data limite de outras linhas na hora.
Cor nova (roxo, `.destaque-saldo-baixo`) pra não confundir com o vermelho
já usado ali pra saldo crítico de ESTOQUE (métrica diferente). Não sai na
impressão/e-mail — é só um filtro visual de trabalho.

## "Itens novos cadastrados na Associação" — Salvar dava "Código não encontrado" (resolvido)

Reportado pelo usuário: no painel de conferência de itens novos, o botão
Salvar falhava pra alguns códigos com `Error: Código "6271/1" não
encontrado na ASSOCIAÇÃO.` — mesmo o código tendo acabado de aparecer
nessa mesma tela, recém-cadastrado sozinho pelo sistema. Nunca tinha
acontecido antes.

Mesma causa-raiz de outros bugs já documentados aqui (ver "Item de
FIO_CRU_BAIXAS aparecendo como data"): o Sheets converte sozinho um código
"cru" — número/número, sem sufixo `/PET`, `COR`, `CABO`, `B`, `BT`... —
em `Date` ao gravar, a menos que a coluna esteja travada em texto puro.
Os 5 códigos do relato (`6271/1`, `4550/1`, `5279/1`, `6254/1`, `6265/1`)
são todos desse formato "cru"; a maioria dos códigos que chegam da
produção tem algum sufixo com letra, o que por acaso já os protegia do
`Date` — por isso só apareceu agora, com os primeiros códigos "crus" a
passar pelo cadastro automático.

`registrarItensNovos` (`Associacao.gs`) gravava a coluna A (e B/C/D) direto
com `setValues()`, sem `.setNumberFormat('@')` — a única gravação de código
no projeto que ainda não tinha essa proteção (as outras cinco, em
`Embarque.gs`/`Analise.gs`/`FioCru.gs`, já a usam pro mesmo formato de
código). Uma vez convertida em `Date`, a célula deixa de bater por texto
contra qualquer comparação — `detectarItensNovos` não reconhece o código
como "já cadastrado" (recadastra duplicado a cada análise nova) e
`corrigirAssociacao` não acha a linha pra corrigir o nome (o erro do
relato).

Corrigido em `Associacao.gs`:

- `registrarItensNovos` — trava as colunas A-D em texto puro
  (`.setNumberFormat('@')`) antes do `setValues()`, igual ao padrão já
  usado nos outros pontos de gravação de código.
- `detectarItensNovos` — usa `_itemDeCelula` (Consultas.gs, já usado em
  `FIO_CRU_BAIXAS`/`PENDENCIA_COMPRA`) pra reconhecer um código mesmo se a
  célula da ASSOCIAÇÃO já tiver sido corrompida em `Date` antes desta
  correção, em vez de tratá-lo como "novo" pra sempre.
- `corrigirAssociacao` — mesma reconstrução via `_itemDeCelula` pra achar
  a linha certa; se a célula do código estiver corrompida, **reescreve o
  próprio código como texto puro na hora**, além de gravar o nome — assim
  o Salvar já cura a linha, diferente do caso de `FIO_CRU_BAIXAS` (onde as
  baixas antigas continuam corrompidas na planilha, só reconstruídas na
  leitura).

Testado com `teste20.js` e regressão completa (`teste.js`–`teste18.js`).

## Bahia: itens "/1" aparecendo como "sem cadastro na ASSOCIAÇÃO" (resolvido)

Reportado pelo usuário (Bahia): na Análise de Estoque, vários itens com o
código terminando em `/1` (ex.: `6254/1`, `6271/1`, `4550/1`, `6265/1`,
`5440/1`, `5861/1`, `6281/1`, `5279/1`) apareciam como "— sem cadastro na
ASSOCIAÇÃO", mesmo o item existindo — inclusive o MESMO código sem o `/1`
(`5279`) aparecia com descrição normalmente.

Mesma causa-raiz da seção acima ("Salvar dava 'Código não encontrado'"): um
código "cru" (número/número, sem sufixo com letra — `/PET`, `COR`, `CABO`,
`B`, `BT`...) vira `Date` sozinho quando o Sheets grava a célula sem ela
estar travada em texto puro (ex.: `6254/1` → 01/01/6254). Só que daquela vez
o reparo (`.setNumberFormat('@')` em `registrarItensNovos`) tratou a causa
para CADASTROS NOVOS dali em diante, mas deixou dois furos:

1. Linhas da ASSOCIAÇÃO já gravadas em `Date` **antes** do reparo continuam
   corrompidas na planilha pra sempre — nada refazia essas células.
2. `_criarLocalizadorDescricao` (Analise.gs) — quem decide "sem cadastro na
   ASSOCIAÇÃO" — casa o código do ESTOQUE contra as colunas B-G (o[s]
   nome[s] padrão). Pra um código "cru" sem sufixo, `_transformarFio`
   devolve o PRÓPRIO código como nome (coluna B = coluna A), então a coluna
   B corrompe junto com a A. Essa função lia B-G direto (`row[c]`), sem a
   reconstrução via `_itemDeCelula` que `detectarItensNovos`/
   `corrigirAssociacao` já usavam pra coluna A — uma célula em `Date` nunca
   bate por texto com nada, então o item cai sempre no "sem cadastro",
   mesmo já cadastrado.

Corrigido:

- `Associacao.gs` — nova `repararAssociacao(token)`: reconstrói (mesmo
  critério de `repararItensPendencia`: só quando o dia é 1) e devolve a
  texto puro qualquer célula em `Date` nas colunas A-G da ASSOCIAÇÃO — não
  só a leitura, a célula na planilha mesmo, pra também curar a fórmula
  nativa (PEDIDO DE FIO, coluna E) que `_criarLocalizadorDescricao`
  reproduz. Só master; botão "Corrigir cadastro da Associação" na tela
  Análise de Estoque (`App.html`), ao lado de "Analisar estoque".
- `Analise.gs` — `_criarLocalizadorDescricao` passa a ler a coluna A e as
  colunas B-G via `_itemDeCelula`, igual ao resto do projeto — reconstrói
  na hora mesmo se a linha ainda não tiver sido reparada (ou pra outra
  unidade), em vez de depender só do botão.

### Efeito colateral: "Código não encontrado" ao salvar item "058" (resolvido)

Direto depois de rodar o "Corrigir cadastro da Associação" e "Analisar
estoque" de novo, o painel "Itens novos cadastrados na Associação" mostrou
um item cru **058 → 58** (o ramo "começa com 0" de `_transformarFio` — ver
`stripZeros`), e o **Salvar** deu `Error: Código "058" não encontrado na
ASSOCIAÇÃO.` mesmo o item tendo acabado de ser cadastrado sozinho ali do
lado.

Causa: `detectarItensNovos` compara o código da produção com o que já está
cadastrado usando só `_norm` (sem tirar zero à esquerda). Se a ASSOCIAÇÃO
já tinha uma linha pro MESMO item cadastrada sem o zero (`58`, de uma
produção anterior), o código novo `058` (COM o zero) não batia com nada
registrado — virava "item novo" e ganhava uma linha PRÓPRIA. Isso por si só
não devia impedir o Salvar (a linha nova existe, com o código certo)... mas
deixava duas linhas pro mesmo item na ASSOCIAÇÃO, o que é o preparo pro
mesmo tipo de inconsistência já visto nos casos de `Date` (duas fontes de
verdade pro mesmo código).

Corrigido em `Associacao.gs` pra tratar "058" e "58" como o MESMO código
em todo lugar que decide "já cadastrado" ou "achar a linha pra salvar" —
mesma regra que `_transformarFio` já usa pra decidir o NOME (`stripZeros`),
só que agora aplicada também na comparação de CÓDIGO:

- `_semZerosEsquerda(s)` — novo helper, mesma regra do `stripZeros` interno
  de `_transformarFio`, só que reutilizável fora daquele fechamento.
- `detectarItensNovos` — o mapa de "já cadastrados" (e o de "já visto nesta
  rodada") ganha também a chave sem zero à esquerda — evita a linha
  duplicada nascer da próxima vez.
- `corrigirAssociacao` — a busca da linha pra corrigir aceita bater tanto
  pelo código exato quanto pela forma sem zero à esquerda — o Salvar
  encontra a linha mesmo se ficou uma duplicata de uma análise anterior a
  este reparo.

Não desfaz duplicata que já exista na planilha (`Salvar` grava na PRIMEIRA
linha que bater) — se sobrar uma linha duplicada de antes deste reparo,
precisa apagar a de mais na mão.
