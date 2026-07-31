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

Corrigido em `_nfCasaComEmbarque` (`Embarque.gs`): agora só casa quando a
NF é **igual** ao número do embarque, ou **começa** por ele seguida de algo
que não é outro dígito (cobre o usuário que digitou um texto a mais por
engano, tipo "983-A"). "9834" ou "15983512" não casam mais — são outros
números.

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
