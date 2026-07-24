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
| **Confirmar Embarque** | Baixa fio crú + baixa lista pendente + grava em EMBARQUES + e-mail (PDF) | ❌ **Não** pelo app (modal já avisa "não pode ser desfeito"). Maior risco. |
| **Enviar urgência** (Tingimento) | Escreve "URGENTE" na observação + e-mail | Parcial: a observação é editável (só master/tingimento); o e-mail não tem como "desenviar". Programação não consegue limpar sozinho. |
| **Enviar Pedido de Fio** (e-mail) | Envia PDF + avança o nº do pedido | E-mail não "desenvia"; não mexe na lista pendente (nada a reverter nos dados). |
| **Gerar compra** (Análise) | Grava/atualiza PENDENCIA_COMPRA | ✅ Dá pra remover item a item ou zerar a lista. |
| **Quantidade Tingida** | Baixa fio crú | ✅ "Corrigir" ajusta pela diferença (credita de volta). |
| **Ajuste de saldo / lote de fio crú** | Ledger append-only | ✅ Novo ajuste compensa; histórico preservado. |

**A resolver (por ordem de risco):**
1. **Cancelar um Embarque confirmado** — o mais importante. Precisa: estornar a
   baixa do fio crú (lançar entradas compensatórias no ledger), devolver as
   quantidades à lista pendente, remover/anular as linhas do embarque em
   EMBARQUES, e (opcional) disparar um e-mail de **cancelamento** avisando os
   contatos (o e-mail original não tem como ser apagado). Ideia: registrar por
   nº de embarque o suficiente pra reverter com segurança.
2. **Cancelar/limpar uma urgência** — botão pra tirar o "URGENTE" da observação
   (inclusive acessível ao Programação), e e-mail de cancelamento opcional.

> Observação geral: **e-mail enviado não volta.** O máximo que dá é mandar uma
> mensagem de cancelamento/retificação. Por isso, idealmente, toda ação com
> e-mail confirma antes (já é assim em Embarque e Urgência).
