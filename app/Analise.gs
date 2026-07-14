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
 *   1. Master informa o período de análise (data inicial e data final).
 *   2. Sistema lê os saldos de estoque no fim do período e identifica itens baixos.
 *   3. Para cada item baixo, calcula o consumo dentro do período informado.
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
  'CLIENTE',       // cliente vinculado (produção, coluna N)
  'TIPO_FIO',      // tipo de fio (poliéster, brilhante, reciclado/pet...)
  'SALDO',         // saldo final (último lançamento do item)
  'CONSUMO_MEDIO', // consumo médio mensal (saídas dos últimos 3 meses ÷ 3)
  'MAQUINAS',      // máquinas de tingimento escolhidas (ex.: "80 + 27")
  'SUGERIDO',      // total do tingimento em kg (soma das máquinas)
  'DATA_LIMITE',   // data limite de embarque (PRIORIDADES DE FIO)
  'OBS',           // observação digitada no painel de tingimento
  'EM_ABERTO',     // já solicitado e ainda não recebido
  'A_COMPRAR',     // diferença final a pedir (SUGERIDO - EM_ABERTO)
  'STATUS'         // URGENTE / NORMAL / etc.
];

/**
 * ETAPA 1 — Lista os itens para o master revisar antes da compra.
 * Retorna, para cada item que teve lançamento dentro do período informado:
 *   - saldo final  = Saldo do lançamento mais recente do item;
 *   - consumo médio = soma das Saídas dos últimos 3 meses (de hoje p/ trás) ÷ 3.
 *
 * @param {string} token
 * @param {Object} params { dataInicio: 'yyyy-mm-dd', dataFim: 'yyyy-mm-dd' }
 * @return {Object} { ok, itens: [{item, descricao, saldo, consumoMedio}], mensagem }
 */
function listarItensParaAnalise(token, params) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  params = params || {};

  var inicio = _parseDataISO(params.dataInicio);
  var fim = _parseDataISO(params.dataFim);
  if (!inicio || !fim) throw new Error('Informe as datas de início e fim.');
  if (inicio.getTime() > fim.getTime()) {
    throw new Error('A data inicial não pode ser maior que a final.');
  }
  fim.setHours(23, 59, 59, 999);

  var hoje = new Date();
  var tresMeses = new Date(hoje.getFullYear(), hoje.getMonth() - 3, hoje.getDate());

  // Mantém a ASSOCIAÇÃO em dia: cadastra automaticamente os itens novos vindos
  // da produção antes de montar a lista (para já saírem com descrição).
  var novosCadastrados = registrarItensNovos(token).adicionados;

  var movimentos = _lerEstoque();
  var descricaoDe = _criarLocalizadorDescricao();
  var tingimentoDe = _criarCalculadoraTingimento();
  var dataLimiteDe = _criarLocalizadorDataLimite();
  var porItem = {};

  movimentos.forEach(function (mov) {
    if (!mov.data) return;
    var chave = _norm(mov.item);
    if (!chave) return;
    if (!porItem[chave]) {
      porItem[chave] = { item: String(mov.item).trim(), ultimo: null, saldo: 0, noPeriodo: false, saidas3m: 0 };
    }
    var reg = porItem[chave];

    // saldo final = saldo do lançamento mais recente do item
    if (!reg.ultimo || mov.data.getTime() > reg.ultimo.getTime()) {
      reg.ultimo = mov.data;
      reg.saldo = mov.saldo;
    }
    // item entra na lista se teve lançamento dentro do período
    if (mov.data.getTime() >= inicio.getTime() && mov.data.getTime() <= fim.getTime()) {
      reg.noPeriodo = true;
    }
    // consumo médio: saídas dos últimos 3 meses
    if (mov.data.getTime() >= tresMeses.getTime() && mov.data.getTime() <= hoje.getTime()) {
      reg.saidas3m += mov.saida;
    }
  });

  var itens = [];
  Object.keys(porItem).forEach(function (k) {
    var r = porItem[k];
    if (!r.noPeriodo) return;
    var d = descricaoDe(r.item);
    var media = Math.ceil(r.saidas3m / 3); // consumo médio arredondado para cima
    var t = tingimentoDe(r.item, r.saldo, media);
    itens.push({
      item: r.item,
      descricao: d.descricao,
      cliente: d.cliente,
      motivo: d.motivo,
      saldo: r.saldo,
      consumoMedio: media,
      tipoFio: t.tipoFio,
      alvo: t.alvo,
      maquinas: t.maquinas.join(' + '),
      totalTingimento: t.total,
      dataLimite: dataLimiteDe(r.item)
    });
  });
  // Do menor saldo para o maior (mais críticos primeiro).
  itens.sort(function (a, b) { return Number(a.saldo) - Number(b.saldo); });

  var msg = itens.length
    ? itens.length + ' item(ns) lançado(s) no período.'
    : 'Nenhum item teve lançamento no período informado.';
  if (novosCadastrados > 0) {
    msg += ' ' + novosCadastrados + ' item(ns) novo(s) cadastrado(s) automaticamente na ASSOCIAÇÃO.';
  }
  return { ok: true, itens: itens, novosCadastrados: novosCadastrados, mensagem: msg };
}

/**
 * ETAPA 2 — Recebe os itens que o master manteve (após excluir os indesejados)
 * e prepara a relação de compra. A conversão pela tabela de tingimento e o
 * desconto de pedidos em aberto serão implementados nas próximas etapas.
 *
 * @param {string} token
 * @param {Object} params { itens: [{item, descricao, saldo, consumoMedio}] }
 */
function gerarRelacaoDeCompra(token, params) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  params = params || {};
  var itens = params.itens || [];
  if (!itens.length) throw new Error('Nenhum item selecionado para a compra.');

  // Persiste a seleção como base da relação (EM_ABERTO/A_COMPRAR/STATUS por ora vazios).
  var linhas = itens.map(function (it) {
    return [
      it.item || '',
      it.descricao || '',
      it.cliente || '',
      it.tipoFio || '',
      it.saldo != null ? it.saldo : '',
      it.consumoMedio != null ? it.consumoMedio : '',
      it.maquinas || '',
      it.totalTingimento != null ? it.totalTingimento : '',
      it.dataLimite || '',      // DATA_LIMITE
      it.obs || '',             // OBS (pode já vir editada na análise)
      '',                       // EM_ABERTO (pedidos em aberto)
      '',                       // A_COMPRAR
      ''                        // STATUS
    ];
  });
  reescreverAba(CONFIG.SHEETS.RELACAO_COMPRA, RELACAO_COMPRA_HEADERS, linhas);

  return {
    ok: true,
    mensagem: itens.length + ' item(ns) selecionado(s) e gravado(s) na base da compra. ' +
      'A compra automática (tabela de tingimento + pedidos em aberto) será ' +
      'ativada na próxima etapa.'
  };
}

/**
 * Carrega a última relação de compra gravada (para exibir sem recalcular).
 */
function obterRelacaoDeCompra(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  var registros = lerRegistros(CONFIG.SHEETS.RELACAO_COMPRA);
  return { ok: true, colunas: RELACAO_COMPRA_HEADERS, linhas: registros };
}

/* ------------------------------ auxiliares ----------------------------- */

/**
 * Lê a aba ESTOQUE e devolve uma lista de movimentos
 * { item, data, entrada, saida, saldo }. As colunas são localizadas pelo
 * nome do cabeçalho (sem depender de acentos, maiúsculas ou posição).
 */
function _lerEstoque() {
  var sh = _aba(CONFIG.SHEETS.ESTOQUE);
  if (!sh) throw new Error('Aba "ESTOQUE" não encontrada na planilha.');
  var last = sh.getLastRow();
  if (last < 2) return [];

  var valores = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
  var header = valores.shift().map(_norm);
  function col(nomes) {
    for (var i = 0; i < header.length; i++) {
      if (nomes.indexOf(header[i]) !== -1) return i;
    }
    return -1;
  }
  var iItem = col(['item']);
  var iData = col(['data']);
  var iEntrada = col(['entrada']);
  var iSaida = col(['saida']);   // "Saída" → "saida"
  var iSaldo = col(['saldo']);   // "Saldo" (não confundir com "saldo anterior")
  if (iItem < 0 || iData < 0 || iSaldo < 0) {
    throw new Error('A aba ESTOQUE precisa ter as colunas Item, Data e Saldo no cabeçalho.');
  }

  var out = [];
  valores.forEach(function (r) {
    var item = r[iItem];
    if (item === '' || item == null || String(item).trim() === '') return;
    out.push({
      item: item,
      data: _parseData(r[iData]),
      entrada: iEntrada >= 0 ? (parseFloat(r[iEntrada]) || 0) : 0,
      saida: iSaida >= 0 ? (parseFloat(r[iSaida]) || 0) : 0,
      saldo: parseFloat(r[iSaldo]) || 0
    });
  });
  return out;
}

/**
 * Cria o localizador de descrição de item, reproduzindo a fórmula da coluna E
 * (REFERENCIA) de PEDIDO DE FIO:
 *   código → ASSOCIAÇÃO (procura em B/C/D/E → devolve A)
 *          → PEDIDO DE FIO (procura A em O → devolve M = descrição da produção).
 * Devolve uma função descricao(codigo) → string ('' quando não há cadastro).
 * (Validado contra a planilha real: reproduz 44/44 as descrições da coluna E.)
 */
function _criarLocalizadorDescricao() {
  // ASSOCIAÇÃO: normalizado(B|C|D|E) → valor da coluna A
  var assocMaps = [{}, {}, {}, {}];
  var shA = _aba(CONFIG.SHEETS.ASSOCIACAO);
  if (shA && shA.getLastRow() > 1) {
    var va = shA.getRange(2, 1, shA.getLastRow() - 1, 5).getValues();
    va.forEach(function (row) {
      var a = row[0];
      for (var c = 1; c <= 4; c++) {
        var k = _norm(row[c]);
        if (k && !(k in assocMaps[c - 1])) assocMaps[c - 1][k] = a;
      }
    });
  }
  // PEDIDO DE FIO: normalizado(O) → { descrição (M), cliente (N) }
  var oInfo = {};
  var shP = _aba(CONFIG.SHEETS.PEDIDO_FIO);
  if (shP && shP.getLastRow() > 1) {
    var vp = shP.getRange(1, 13, shP.getLastRow(), 3).getValues(); // colunas M, N, O
    vp.forEach(function (row) {
      var o = _norm(row[2]); // O
      var m = row[0];        // M (descrição)
      var n = row[1];        // N (cliente)
      if (o && m !== '' && m != null && !(o in oInfo)) {
        oInfo[o] = { descricao: String(m).trim(), cliente: (n == null ? '' : String(n).trim()) };
      }
    });
  }
  return function (codigo) {
    var vl = _norm(codigo);
    if (!vl) return { descricao: '', cliente: '', motivo: '' };
    var achouAssoc = false;
    for (var i = 0; i < assocMaps.length; i++) {
      if (vl in assocMaps[i]) {
        achouAssoc = true;
        var cod = _norm(assocMaps[i][vl]);
        if (cod in oInfo) {
          return { descricao: oInfo[cod].descricao, cliente: oInfo[cod].cliente, motivo: '' };
        }
      }
    }
    return {
      descricao: '', cliente: '',
      motivo: achouAssoc ? 'cadastrado, sem descrição na produção' : 'sem cadastro na ASSOCIAÇÃO'
    };
  };
}

/**
 * Cria o localizador da DATA LIMITE DE EMBARQUE, reproduzindo a fórmula da
 * coluna F de PEDIDO DE FIO: procura o código do item na coluna A da
 * PRIORIDADES DE FIO (importada nas colunas K/L) e devolve a data (coluna B).
 * Devolve uma função dataLimite(codigo) → string 'dd/MM/aaaa' ('' se não há).
 */
function _criarLocalizadorDataLimite() {
  var mapa = {};
  var sh = _aba(CONFIG.SHEETS.PEDIDO_FIO);
  if (sh && sh.getLastRow() > 1) {
    var vals = sh.getRange(1, 11, sh.getLastRow(), 2).getValues(); // colunas K, L
    vals.forEach(function (row) {
      var k = _norm(row[0]); // K = código (CORES)
      var l = row[1];        // L = data limite
      if (k && k !== 'cores' && l !== '' && l != null && !(k in mapa)) mapa[k] = l;
    });
  }
  return function (codigo) {
    var k = _norm(codigo);
    return _formatarDataLimite(k in mapa ? mapa[k] : '');
  };
}

/** Formata a data limite (Date ou serial) como dd/MM/aaaa; '' quando vazio. */
function _formatarDataLimite(v) {
  if (v === '' || v == null) return '';
  var d = v;
  if (typeof v === 'number') d = new Date(Math.round((v - 25569) * 86400000)); // serial do Sheets → Date
  if (d instanceof Date && !isNaN(d.getTime())) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  }
  return String(v);
}

/** Normaliza texto para comparação (minúsculas, sem acento, sem espaços extras). */
function _norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Converte um valor de célula de data em Date, ou null. Aceita dd/mm/aaaa em texto. */
function _parseData(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string') {
    var m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
      return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    }
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Converte 'yyyy-mm-dd' (input date) em Date local, ou null. */
function _parseDataISO(s) {
  if (!s) return null;
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}
