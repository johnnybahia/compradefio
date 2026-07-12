/**
 * Analise.gs
 * Motor da análise de estoque → relação de materiais para compra.
 *
 * ESTE ARQUIVO É O ESQUELETO. A estrutura (contrato de dados, etapas e
 * gravação do resultado) já está definida; a lógica de cada etapa será
 * preenchida conforme fecharmos as regras de negócio:
 *   - como ler o saldo de estoque na data de corte;
 *   - o cálculo do consumo dos últimos 3 meses;
 *   - a proporção pela tabela de tingimento;
 *   - o desconto de pedidos já em aberto (para não duplicar).
 *
 * Fluxo pretendido (conforme descrito pelo cliente):
 *   1. Master informa uma data de corte.
 *   2. Sistema lê os saldos de estoque nessa data e identifica itens baixos.
 *   3. Para cada item baixo, calcula o consumo dos últimos 3 meses.
 *   4. Consulta a tabela de tingimento e define quanto pedir, proporcional às
 *      quantidades de tingimento disponíveis.
 *   5. Desconta o que já existe em pedido aberto (pede só a diferença).
 *   6. Anexa a DESCRIÇÃO/REFERÊNCIA de cada item (o texto que identifica o
 *      produto para o usuário — hoje visível na aba PEDIDO DE FIO, coluna E).
 *   7. Grava em RELACAO_COMPRA e devolve para a tela.
 */

/** Colunas da relação de compra (contrato com a interface e o banco). */
var RELACAO_COMPRA_HEADERS = [
  'ITEM',          // código do produto/cor
  'DESCRICAO',     // referência que identifica o item para o usuário
  'TIPO_FIO',      // tipo de fio (poliéster, brilhante, reciclado/pet...)
  'SALDO',         // saldo atual na data de corte
  'CONSUMO_3M',    // consumo dos últimos 3 meses
  'SUGERIDO',      // quantidade sugerida pela análise (tabela de tingimento)
  'EM_ABERTO',     // já solicitado e ainda não recebido
  'A_COMPRAR',     // diferença final a pedir (SUGERIDO - EM_ABERTO)
  'STATUS'         // URGENTE / NORMAL / etc.
];

/**
 * Gera a relação de compra a partir de uma data de corte.
 * Apenas o master pode executar.
 *
 * @param {string} token  token de sessão
 * @param {Object} params { dataCorte: 'yyyy-mm-dd' }
 * @return {Object} { ok, colunas, linhas, mensagem }
 */
function gerarRelacaoDeCompra(token, params) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  params = params || {};

  var dataCorte = _parseDataISO(params.dataCorte);
  if (!dataCorte) {
    throw new Error('Informe uma data de corte válida.');
  }

  // -------------------------------------------------------------------
  // ETAPAS 2 a 6 — a implementar conforme as regras de negócio.
  //
  // var saldos      = _lerSaldosNaData(dataCorte);
  // var baixos      = _filtrarEstoqueBaixo(saldos);
  // var consumo     = _consumo3Meses(baixos, dataCorte);
  // var sugestao    = _aplicarTabelaTingimento(consumo);
  // var emAberto    = _pedidosEmAberto();
  // var linhas      = _montarLinhas(sugestao, emAberto);  // desconta duplicidade
  // _anexarDescricoes(linhas);                            // coluna DESCRICAO
  // -------------------------------------------------------------------
  var linhas = []; // estrutura pronta; lógica pendente

  // Grava o resultado no banco (mesmo vazio, deixa a aba criada e pronta).
  reescreverAba(
    CONFIG.SHEETS.RELACAO_COMPRA,
    RELACAO_COMPRA_HEADERS,
    linhas.map(function (l) {
      return RELACAO_COMPRA_HEADERS.map(function (h) { return l[h] !== undefined ? l[h] : ''; });
    })
  );

  return {
    ok: true,
    colunas: RELACAO_COMPRA_HEADERS,
    linhas: linhas,
    mensagem: linhas.length
      ? 'Relação de compra gerada com ' + linhas.length + ' itens.'
      : 'Estrutura pronta. A lógica de análise será ativada assim que ' +
        'definirmos as regras de tingimento, fio cru e pedidos em aberto.'
  };
}

/**
 * Carrega a última relação de compra gravada (para exibir sem recalcular).
 */
function obterRelacaoDeCompra(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  var registros = lerRegistros(CONFIG.SHEETS.RELACAO_COMPRA);
  return {
    ok: true,
    colunas: RELACAO_COMPRA_HEADERS,
    linhas: registros
  };
}

/* ------------------------------ auxiliares ----------------------------- */

/** Converte 'yyyy-mm-dd' (input date) em Date local, ou null. */
function _parseDataISO(s) {
  if (!s) return null;
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}
