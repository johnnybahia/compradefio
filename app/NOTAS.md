# Notas / pendências do projeto Marfim

Anotações de coisas a acompanhar/melhorar (não são bugs — são decisões e
pendências que valem manter à vista).

## Cancelamento / reversão de procedimentos (IMPORTANTE)

**Princípio:** toda ação que gera efeito real (baixa de estoque, envio de
e-mail, gravação que muda saldo) deveria ter um caminho de **cancelar/desfazer**
no próprio sistema — ou, no mínimo, um aviso claro + registro de quem fez e
quando. Hoje isso ainda não está uniforme. Mapa da situação atual:

| Procedimento | O que faz | Dá pra desfazer hoje? |
|---|---|---|
| **Confirmar Embarque** | Baixa fio crú + baixa lista pendente + grava em EMBARQUES + e-mail (PDF) | ✅ **Sim** agora — botão "Cancelar embarque" (por número, no histórico): estorna o crú (baixa compensatória a partir do instantâneo `EMBARQUE_ESTORNO`), devolve os itens à pendência, marca CANCELADO e (opcional) manda e-mail de cancelamento. O e-mail original não volta. |
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

> Observação geral: **e-mail enviado não volta.** O máximo que dá é mandar uma
> mensagem de cancelamento/retificação. Por isso, idealmente, toda ação com
> e-mail confirma antes (já é assim em Embarque e Urgência).
