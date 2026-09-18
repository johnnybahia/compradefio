/**
 * DiagnosticoIdLinha.gs
 * Consulta SÓ LEITURA — não grava nada, sem risco nenhum. Rodada na mão pelo
 * editor do Apps Script: "Selecionar função" → `identificarItensAmbiguosCeara`
 * (ou `...Bahia`) → Executar → ver o "Log de execução" (Ctrl+Enter).
 *
 * Lista os itens que HOJE têm o mesmo código em 2+ linhas abertas de
 * PENDENCIA_COMPRA — o caso que `_migrarIdLinhaFioCruBaixas` (Migracao.gs)
 * não consegue resolver sozinha, porque não dá pra saber pra qual dos
 * pedidos cada baixa antiga pertence só pelos dados gravados.
 *
 * Pra cada item ambíguo, mostra:
 *   - os pedidos envolvidos (cliente, descrição, quantidade, ID_LINHA);
 *   - o total tingido "misturado" (soma de todas as baixas sem ID_LINHA
 *     desse código — hoje aparece igual nos dois pedidos);
 *   - cada baixa individual (data/hora, quantidade, NF, usuário) — é o que
 *     ajuda a lembrar/reconstruir qual lançamento foi de qual pedido (pela
 *     data, pelo usuário que lançou, ou pela quantidade batendo com o
 *     combinado de algum cliente).
 */
function identificarItensAmbiguosCeara() { return _identificarItensAmbiguos('CEARA'); }
function identificarItensAmbiguosBahia() { return _identificarItensAmbiguos('BAHIA'); }

function _identificarItensAmbiguos(unidadeId) {
  _definirUnidadeAtiva(unidadeId);

  // Pendências ABERTAS, agrupadas por código de item normalizado.
  var porItem = {};
  lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA).filter(_emAberto).forEach(function (r) {
    var k = _norm(r.ITEM);
    if (!k) return;
    if (!porItem[k]) porItem[k] = [];
    porItem[k].push(r);
  });

  // Baixas SEM ID_LINHA (as que a migração não resolveu) desses mesmos códigos.
  var baixasPorItem = {};
  _lerBaixasFioCru().forEach(function (r) {
    if (String(r.ID_LINHA || '').trim()) return; // já resolvida — não é o problema
    var k = _norm(r.ITEM);
    if (!k) return;
    if (!baixasPorItem[k]) baixasPorItem[k] = [];
    baixasPorItem[k].push(r);
  });

  var ambiguos = [];
  Object.keys(porItem).forEach(function (k) {
    var pendencias = porItem[k];
    if (pendencias.length < 2) return; // só é ambíguo com 2+ pedidos abertos no mesmo código
    var baixas = (baixasPorItem[k] || []).sort(function (a, b) {
      var da = a.DATA_HORA instanceof Date ? a.DATA_HORA.getTime() : 0;
      var db = b.DATA_HORA instanceof Date ? b.DATA_HORA.getTime() : 0;
      return da - db;
    });
    var totalMisturado = baixas.reduce(function (s, r) { return s + (Number(r.QUANTIDADE) || 0); }, 0);
    ambiguos.push({
      item: _itemDeCelula(pendencias[0].ITEM),
      tipoFio: String(pendencias[0].TIPO_FIO || '').trim(),
      totalTingidoMisturado: Math.round(totalMisturado * 1000) / 1000,
      pedidos: pendencias.map(function (r) {
        return {
          idLinha: String(r.ID_LINHA || '').trim(),
          cliente: String(r.CLIENTE || '').trim(),
          descricao: _itemDeCelula(r.DESCRICAO),
          sugerido: Number(r.SUGERIDO) || 0,
          baseline: Number(r.TINGIDO_BASELINE) || 0,
          liberado: Number(r.PRONTO_EMBARQUE) || 0,
          geradoEm: r.GERADO_EM
        };
      }),
      baixas: baixas.map(function (r) {
        return {
          dataHora: r.DATA_HORA, quantidade: Number(r.QUANTIDADE) || 0,
          nf: r.NF, usuario: String(r.USUARIO || '').trim()
        };
      })
    });
  });

  Logger.log('=== Itens com o mesmo código em 2+ pedidos abertos — unidade ' + unidadeId + ' ===');
  if (!ambiguos.length) {
    Logger.log('Nenhum item ambíguo agora — nada pra resolver.');
  }
  ambiguos.forEach(function (a) {
    Logger.log('');
    Logger.log('--- Item "' + a.item + '" (' + a.tipoFio + ') — total tingido misturado hoje: ' +
      a.totalTingidoMisturado + 'kg (aparece igual nos ' + a.pedidos.length + ' pedidos abaixo) ---');
    a.pedidos.forEach(function (p, i) {
      Logger.log('  Pedido ' + (i + 1) + ': cliente="' + p.cliente + '" · descrição="' + p.descricao +
        '" · pedido=' + p.sugerido + 'kg · já embarcado antes=' + p.baseline + 'kg · liberado=' +
        p.liberado + 'kg · gerado em ' + p.geradoEm + ' · ID_LINHA=' + p.idLinha);
    });
    Logger.log('  Baixas sem ID_LINHA (' + a.baixas.length + '), em ordem cronológica:');
    a.baixas.forEach(function (b) {
      Logger.log('    ' + b.dataHora + ' — ' + b.quantidade + 'kg — NF ' + b.nf + ' — lançado por ' + b.usuario);
    });
  });
  Logger.log('');
  Logger.log('=== Fim — ' + ambiguos.length + ' item(ns) ambíguo(s) na unidade ' + unidadeId + ' ===');

  return { unidade: unidadeId, ambiguos: ambiguos };
}
