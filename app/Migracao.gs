/**
 * Migracao.gs
 * Utilitário de ÚNICA execução — pode ser apagado depois de usado.
 *
 * Antes da separação em duas abas (PENDENCIA_COMPRA / RELACAO_COMPRA),
 * RELACAO_COMPRA era a ÚNICA lista de trabalho da compra — era ali que o
 * pedido acumulava. Quando o rascunho passou a ser PENDENCIA_COMPRA, a tela
 * de Tingimento e todo o resto do sistema passaram a ler só dela — o que já
 * estava em RELACAO_COMPRA ficou "preso" lá, invisível pro sistema.
 *
 * Estas funções trazem essas linhas de volta pra PENDENCIA_COMPRA, sem
 * duplicar o que já estiver pendente (mesma chave item + data limite usada
 * em `gerarRelacaoDeCompra`) e SEM apagar nada de RELACAO_COMPRA — só copia.
 * Forçam STATUS = ABERTO em tudo que migrar (mesmo o que porventura estava
 * marcado ENVIADO por engano, do período em que o envio arquivava errado).
 *
 * Como rodar: no editor do Apps Script, escolha no menu "Selecionar função"
 * `migrarRelacaoParaPendenciaCeara` (ou `...Bahia`) e clique em Executar —
 * uma vez para cada unidade que tiver dado em RELACAO_COMPRA. Não precisa
 * de login/sessão (roda direto, como qualquer função do editor). Pode rodar
 * de novo sem medo: é idempotente.
 */
function migrarRelacaoParaPendenciaCeara() { return _migrarRelacaoParaPendencia('CEARA'); }
function migrarRelacaoParaPendenciaBahia() { return _migrarRelacaoParaPendencia('BAHIA'); }

function _migrarRelacaoParaPendencia(unidadeId) {
  _definirUnidadeAtiva(unidadeId);

  var antigos = lerRegistros(CONFIG.SHEETS.RELACAO_COMPRA);
  if (!antigos.length) {
    Logger.log('%s: RELACAO_COMPRA está vazia — nada para migrar.', unidadeId);
    return { unidade: unidadeId, migrados: 0, jaPendentes: 0 };
  }

  var sh = _prepararAbaCompra(CONFIG.SHEETS.PENDENCIA_COMPRA);
  var chavesExistentes = {};
  lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA).forEach(function (r) {
    var k = _chaveItemData(r.ITEM, r.DATA_LIMITE);
    if (k) chavesExistentes[k] = true;
  });

  var novas = [];
  antigos.forEach(function (r) {
    var chave = _chaveItemData(r.ITEM, r.DATA_LIMITE);
    if (!chave || chavesExistentes[chave]) return; // já está pendente, não duplica
    chavesExistentes[chave] = true;
    novas.push(RELACAO_COMPRA_HEADERS.map(function (h) {
      if (h === 'STATUS') return 'ABERTO';
      return r[h] == null ? '' : r[h];
    }));
  });

  if (novas.length) {
    sh.getRange(sh.getLastRow() + 1, 1, novas.length, RELACAO_COMPRA_HEADERS.length).setValues(novas);
  }
  var jaPendentes = antigos.length - novas.length;
  Logger.log('%s: %s de %s linha(s) migrada(s) de RELACAO_COMPRA para PENDENCIA_COMPRA (%s já estavam pendentes).',
    unidadeId, novas.length, antigos.length, jaPendentes);
  return { unidade: unidadeId, migrados: novas.length, jaPendentes: jaPendentes };
}

/**
 * Preenche o ID_LINHA (identificador estável, UUID) de toda linha de
 * PENDENCIA_COMPRA que ainda não tem — necessário depois que a coluna
 * ID_LINHA foi adicionada a RELACAO_COMPRA_HEADERS, pra que remover/editar/
 * marcar urgência num item passasse a identificá-lo por esse ID em vez da
 * posição física na planilha (a posição desloca a cada linha removida e
 * podia acabar agindo sobre o item errado).
 *
 * Como rodar: no editor do Apps Script, escolha `migrarIdLinhaPendenciaCeara`
 * (ou `...Bahia`) e clique em Executar — uma vez para cada unidade, ANTES de
 * liberar a tela de Tingimento pros usuários (sem isso, a linha ainda sem
 * ID_LINHA não é encontrada quando alguém tenta remover/editar/marcar
 * urgência nela — a tela mostra "Item não encontrado — recarregue a tela").
 * Idempotente: rodar de novo não mexe nas linhas que já têm ID_LINHA.
 */
function migrarIdLinhaPendenciaCeara() { return _migrarIdLinhaPendencia('CEARA'); }
function migrarIdLinhaPendenciaBahia() { return _migrarIdLinhaPendencia('BAHIA'); }

function _migrarIdLinhaPendencia(unidadeId) {
  _definirUnidadeAtiva(unidadeId);
  _prepararAbaCompra(CONFIG.SHEETS.PENDENCIA_COMPRA); // garante que a coluna ID_LINHA existe
  var regs = lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA);
  var preenchidos = 0;
  regs.forEach(function (r) {
    if (String(r.ID_LINHA || '').trim()) return; // já tem ID — não mexe
    atualizarCelula(CONFIG.SHEETS.PENDENCIA_COMPRA, r.__row, 'ID_LINHA', Utilities.getUuid());
    preenchidos++;
  });
  Logger.log('%s: %s de %s linha(s) de PENDENCIA_COMPRA receberam ID_LINHA novo.',
    unidadeId, preenchidos, regs.length);
  return { unidade: unidadeId, preenchidos: preenchidos, total: regs.length };
}

/**
 * Preenche o ID_LINHA (ver `FIO_CRU_BAIXAS_HEADERS`, em FioCru.gs) de toda
 * baixa gravada ANTES dessa coluna existir — pra que "já tingido" e o
 * "consumo no estoque de fio crú" (Confirmação de Embarque) parem de somar
 * pelo texto do item (ambíguo: o mesmo código de cor/estilo pode estar em
 * 2+ pedidos abertos ao mesmo tempo — bug reportado) e passem a somar por
 * pedido, sem ambiguidade.
 *
 * Só resolve uma baixa quando, NO MOMENTO EM QUE ESTA MIGRAÇÃO RODA, existe
 * exatamente UMA linha aberta em PENDENCIA_COMPRA com aquele código de item —
 * nesse caso, não há dúvida de qual pedido a baixa pertence. Duas situações
 * ficam de fora, DE PROPÓSITO (documentado, não é falha silenciosa):
 *   - item sem NENHUMA linha aberta hoje (pedido já fechado/embarcado há
 *     tempo) — a baixa fica sem ID_LINHA, mas como não há mais pendência
 *     pra procurá-la, isso nunca é lido de novo por engano;
 *   - item com 2+ linhas abertas hoje (mesmo código em pedidos simultâneos,
 *     como "2427 30-2") — não dá pra saber qual baixa antiga é de qual
 *     pedido sem inventar informação; essas baixas continuam somando pelo
 *     texto do item (comportamento de sempre) até um desses pedidos fechar
 *     e a ambiguidade se desfizer sozinha (ela não se resolve nunca de
 *     forma automática depois — rode a migração de novo se quiser tentar
 *     resolver o que ficou de fora, mas só funciona se a ambiguidade já
 *     tiver sumido: um dos pedidos ter sido confirmado/removido).
 *
 * Como rodar: igual às demais — `migrarIdLinhaFioCruBaixasCeara` (ou
 * `...Bahia`) no editor do Apps Script. Idempotente: baixa que já tem
 * ID_LINHA nunca é tocada de novo.
 */
function migrarIdLinhaFioCruBaixasCeara() { return _migrarIdLinhaFioCruBaixas('CEARA'); }
function migrarIdLinhaFioCruBaixasBahia() { return _migrarIdLinhaFioCruBaixas('BAHIA'); }

function _migrarIdLinhaFioCruBaixas(unidadeId) {
  _definirUnidadeAtiva(unidadeId);
  _prepararFioCruBaixas(); // garante que a coluna ID_LINHA existe

  var porItem = {}; // item normalizado -> [ID_LINHA, ...] das linhas ABERTAS com esse código
  lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA).filter(_emAberto).forEach(function (r) {
    var k = _norm(r.ITEM);
    var idLinha = String(r.ID_LINHA || '').trim();
    if (!k || !idLinha) return;
    if (!porItem[k]) porItem[k] = [];
    porItem[k].push(idLinha);
  });

  var baixas = _lerBaixasFioCru();
  var preenchidos = 0, ambiguos = 0, semPendenciaAberta = 0, jaTinham = 0;
  baixas.forEach(function (r) {
    if (String(r.ID_LINHA || '').trim()) { jaTinham++; return; }
    var candidatos = porItem[_norm(r.ITEM)] || [];
    if (candidatos.length === 1) {
      atualizarCelula(CONFIG.SHEETS.FIO_CRU_BAIXAS, r.__row, 'ID_LINHA', candidatos[0]);
      preenchidos++;
    } else if (candidatos.length === 0) {
      semPendenciaAberta++;
    } else {
      ambiguos++;
    }
  });

  Logger.log(
    '%s: %s de %s baixa(s) de FIO_CRU_BAIXAS receberam ID_LINHA (%s já tinham, %s sem pendência aberta pra ' +
    'resolver, %s ficaram ambíguas — 2+ pedidos abertos com o mesmo código de item).',
    unidadeId, preenchidos, baixas.length, jaTinham, semPendenciaAberta, ambiguos);
  return { unidade: unidadeId, preenchidos: preenchidos, total: baixas.length, jaTinham: jaTinham, semPendenciaAberta: semPendenciaAberta, ambiguos: ambiguos };
}
