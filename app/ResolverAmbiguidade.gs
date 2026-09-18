/**
 * ResolverAmbiguidade.gs
 * AO CONTRÁRIO de DiagnosticoIdLinha.gs, isto GRAVA na planilha — só rode
 * depois de conferir pela consulta `identificarItensAmbiguosCeara/Bahia` que
 * a atribuição faz sentido (idealmente: o ID_LINHA de destino tem
 * TINGIDO_BASELINE batendo com a soma das baixas órfãs daquele item).
 *
 * `_resolverAmbiguidade` é o motor genérico (recebe item + ID_LINHA de
 * destino) — mas o editor do Apps Script só roda função SEM parâmetro pelo
 * menu "Selecionar função", então cada caso confirmado vira uma função
 * própria, com os valores já embutidos (não precisa digitar nada).
 *
 * Protegida contra erro de digitação: só aceita um ID_LINHA que já exista
 * numa linha ABERTA de PENDENCIA_COMPRA com o MESMO código de item — se não
 * bater, recusa e não grava nada.
 */

/** Item "2427 30-2" (Ceará) — a única baixa órfã (25kg, 28/08) tem o mesmo
 * valor do TINGIDO_BASELINE do Pedido 1 ("ATAC. M60126 6MM ALPINA COR 2427",
 * cliente DASS ITAPIPOCA, pedido novo de 2kg) — é dele. */
function resolverAmbiguidade_2427_Ceara() {
  return _resolverAmbiguidade('CEARA', '2427 30-2', 'ab4d00b6-42df-46f6-8757-f4a992649a0e');
}

/** Item "4662/1 RECICLADO" (Bahia) — as duas baixas órfãs (103,6kg + 591,4kg
 * = 695kg) somam exatamente o TINGIDO_BASELINE do Pedido 1 ("ATAC. MR110029
 * RECICLADO COR 4662/PET", cliente DASS SEST, pedido residual de 37kg) —
 * são dele. */
function resolverAmbiguidade_4662_Bahia() {
  return _resolverAmbiguidade('BAHIA', '4662/1 RECICLADO', '2db1c215-2836-4d01-8ee0-116926762f1a');
}

function _resolverAmbiguidade(unidadeId, item, idLinhaDestino) {
  _definirUnidadeAtiva(unidadeId);
  idLinhaDestino = String(idLinhaDestino || '').trim();
  if (!idLinhaDestino) throw new Error('Informe o ID_LINHA de destino.');

  // Confere que o ID_LINHA de destino é uma pendência de verdade, com o
  // MESMO código de item — barra na hora um ID digitado errado ou de outro
  // item, antes de gravar qualquer coisa.
  var pendente = lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA)
    .filter(function (r) { return _norm(r.ID_LINHA) === _norm(idLinhaDestino); })[0];
  if (!pendente) {
    throw new Error('ID_LINHA "' + idLinhaDestino + '" não encontrado em nenhuma linha de PENDENCIA_COMPRA — nada gravado.');
  }
  if (_norm(pendente.ITEM) !== _norm(item)) {
    throw new Error('O ID_LINHA informado é da linha do item "' + pendente.ITEM + '", não de "' + item +
      '" — confira se é o ID certo. Nada gravado.');
  }

  var orfas = _lerBaixasFioCru()
    .filter(function (r) { return !String(r.ID_LINHA || '').trim() && _norm(r.ITEM) === _norm(item); });
  if (!orfas.length) {
    Logger.log(unidadeId + ': nenhuma baixa órfã encontrada pra "' + item + '" — nada a fazer (já foi resolvido antes?).');
    return { unidade: unidadeId, item: item, atribuidas: 0 };
  }

  orfas.forEach(function (r) {
    atualizarCelula(CONFIG.SHEETS.FIO_CRU_BAIXAS, r.__row, 'ID_LINHA', idLinhaDestino);
  });

  var total = orfas.reduce(function (s, r) { return s + (Number(r.QUANTIDADE) || 0); }, 0);
  Logger.log(unidadeId + ': ' + orfas.length + ' baixa(s) de "' + item + '" (total ' + total +
    'kg) atribuída(s) ao pedido de "' + pendente.CLIENTE + '" (ID_LINHA ' + idLinhaDestino + ').');
  return { unidade: unidadeId, item: item, atribuidas: orfas.length, totalKg: total, cliente: pendente.CLIENTE };
}
