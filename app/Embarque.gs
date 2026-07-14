/**
 * Embarque.gs
 * Lê um PDF de relatório de embarque, interpreta os itens e preenche a aba
 * EMBARQUES (A=item, B=quantidade/peso, C=nº embarque, D=data, E=situação vazia).
 *
 * Fluxo:
 *   1. analisarEmbarquePdf(token, base64) → extrai o texto, interpreta e devolve
 *      uma PRÉVIA (nº do doc, data e itens), marcando o que não reconheceu.
 *   2. O usuário confere/ajusta e chama gravarEmbarque(token, dados), que grava
 *      na aba EMBARQUES e memoriza as descrições novas (aprendizado).
 *
 * Regras de normalização (descrição do PDF → item do estoque), validadas com o
 * cliente. A base é fixa; descrições novas/variações são aprendidas.
 */

/** Regras de sufixo por tipo de fio (procura a 1ª palavra-chave contida na descrição). */
function _regrasSufixoEmbarque() {
  return [
    { kw: 'brilhante', suf: ' BRILHANTE' },
    { kw: 'polimp',    suf: '/P' },
    { kw: 'reflex',    suf: '/1 RECICLADO' },
    { kw: 'reciclado', suf: '/1 RECICLADO' },
    { kw: 'lavado',    suf: ' LAVADO' },
    { kw: '30/2',      suf: ' 30-2' },
    { kw: 'alpina',    suf: ' 30-2' },
    { kw: 'poliester', suf: '' }
  ];
}

/** Remove zeros à esquerda do código da cor (ex.: "009" → "9"). */
function _codEmbarque(codigo) {
  return String(codigo).replace(/^0+/, '') || '0';
}

/**
 * Interpreta o texto do PDF de embarque.
 *
 * A conversão do PDF para texto (via Drive → Google Doc) NÃO preserva as
 * quebras de linha do relatório original: vários itens podem cair juntos
 * numa mesma linha de texto (separados só por espaço), e um item pode
 * ficar dividido em várias linhas. Por isso o texto inteiro é normalizado
 * (todo espaço em branco vira um espaço só) e os itens são extraídos com
 * uma busca global pelo padrão "cor CÓDIGO - caixas cx - peso", em vez de
 * depender de onde estão as quebras de linha.
 *
 * @return {Object} { doc, data, linhas: [{descricao, tipo, codigo, quantidade, caixas, peso}] }
 */
function _parseEmbarque(texto) {
  var normalizado = String(texto || '').replace(/\s+/g, ' ').trim();

  var md = normalizado.match(/n[°ºo]\s*(\d+)/i);
  var doc = md ? md[1] : '';

  // Remove a saudação fixa do relatório ("...que embarcou dia [data]") antes
  // de procurar os itens, para essa frase não ser confundida com o tipo do
  // 1º item; a data do embarque, quando presente no texto, vem logo ali.
  var corte = normalizado.match(/embarcou\s+dia\s*/i);
  var data = '', corpo = normalizado;
  if (corte) {
    var resto = normalizado.slice(corte.index + corte[0].length);
    var mdt = resto.match(/^(\d{2}\/\d{2}\/\d{4})/);
    if (mdt) { data = mdt[1]; resto = resto.slice(mdt[0].length); }
    corpo = resto;
  }

  var RE = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\/ ]{0,24}?)\s*\bcor\s+([^\s\-–—_.]+)\s*[-–—_.]+\s*(\d+)\s*cx\s*[-–—_.]+\s*([\d.,]+)/gi;
  var out = [], m;
  while ((m = RE.exec(corpo)) !== null) {
    var peso = parseFloat(String(m[4]).replace(',', '.'));
    if (isNaN(peso)) peso = null;
    var tipo = m[1].trim();
    out.push({
      descricao: (tipo + ' cor ' + m[2]).replace(/\s+/g, ' '),
      tipo: tipo,
      codigo: m[2],
      caixas: parseInt(m[3], 10),
      peso: peso,
      quantidade: peso != null ? Math.floor(peso) : null
    });
  }
  return { doc: doc, data: data, linhas: out };
}

/** Extrai o texto de um PDF (base64) via conversão do Drive para Google Doc. */
function _extrairTextoPdf(base64, nome) {
  var bytes = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(bytes, 'application/pdf', nome || 'embarque.pdf');
  var doc = Drive.Files.insert(
    { title: 'tmp_embarque_' + Date.now(), mimeType: 'application/vnd.google-apps.document' },
    blob
  );
  var texto = '';
  try {
    texto = DocumentApp.openById(doc.id).getBody().getText();
  } finally {
    try { Drive.Files.remove(doc.id); } catch (e) {}
  }
  return texto;
}

/** Conjunto de itens do estoque: normalizado → valor original. */
function _itensEstoqueSet() {
  var sh = _aba(CONFIG.SHEETS.ESTOQUE);
  var set = {};
  if (!sh) return set;
  var last = sh.getLastRow();
  if (last < 2) return set;
  var vals = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
  var nh = vals.shift().map(function (h) { return _norm(h); });
  var i = nh.indexOf('item'); if (i < 0) i = 1;
  vals.forEach(function (r) {
    var it = r[i];
    if (it === '' || it == null) return;
    var s = String(it).trim();
    if (s) set[_norm(s)] = s;
  });
  return set;
}

/** Aprendizado: normalizado(descrição) → item. */
function _lerMapaEmbarque() {
  var sh = _aba(CONFIG.SHEETS.MAPA_EMBARQUE);
  var mapa = {};
  if (!sh || sh.getLastRow() < 2) return mapa;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  vals.forEach(function (r) {
    var d = _norm(r[0]);
    if (d && r[1] !== '' && r[1] != null) mapa[d] = String(r[1]).trim();
  });
  return mapa;
}

/** Salva descrições aprendidas (descrição → item), sem duplicar. */
function _salvarMapaEmbarque(pares) {
  var existentes = _lerMapaEmbarque();
  var novos = [];
  pares.forEach(function (p) {
    if (!p.descricao || !p.item) return;
    var k = _norm(p.descricao);
    if (existentes[k]) return;
    existentes[k] = String(p.item).trim();
    novos.push([String(p.descricao).trim(), String(p.item).trim()]);
  });
  if (!novos.length) return;
  var sh = _aba(CONFIG.SHEETS.MAPA_EMBARQUE, ['DESCRICAO', 'ITEM']);
  sh.getRange(sh.getLastRow() + 1, 1, novos.length, 2).setValues(novos);
}

/**
 * Analisa um PDF de embarque e devolve a prévia para conferência.
 * @param {string} base64  conteúdo do PDF em base64 (sem o prefixo data:)
 */
function analisarEmbarquePdf(token, base64, nome) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  if (!base64) throw new Error('Nenhum arquivo recebido.');

  var texto = _extrairTextoPdf(base64, nome);
  var p = _parseEmbarque(texto);
  if (!p.linhas.length) {
    throw new Error('Não consegui ler itens neste PDF. Confira se é o relatório de embarque.');
  }

  var estoque = _itensEstoqueSet();
  var aprendido = _lerMapaEmbarque();
  var regras = _regrasSufixoEmbarque();

  var itens = p.linhas.map(function (l) {
    var chave = _norm(l.descricao);
    var item = '', ok = false, motivo = '';

    if (aprendido[chave]) {
      item = aprendido[chave]; ok = true; motivo = 'aprendido';
    } else {
      var suf = null, t = _norm(l.tipo);
      for (var i = 0; i < regras.length; i++) {
        if (t.indexOf(regras[i].kw) !== -1) { suf = regras[i]; break; }
      }
      if (suf) {
        var cand = _codEmbarque(l.codigo) + suf.suf;
        if (estoque[_norm(cand)]) { item = estoque[_norm(cand)]; ok = true; }
        else { item = cand; motivo = 'não encontrado no estoque'; }
      } else {
        motivo = 'descrição desconhecida';
      }
    }
    return {
      descricao: l.descricao, codigo: l.codigo,
      quantidade: l.quantidade, item: item, ok: ok, motivo: motivo
    };
  });

  return {
    ok: true,
    doc: p.doc,
    data: p.data,
    itens: itens,
    naoReconhecidos: itens.filter(function (i) { return !i.ok; }).length,
    textoBruto: texto
  };
}

/**
 * Grava o embarque conferido na aba EMBARQUES e memoriza as descrições novas.
 * @param {Object} dados { doc, data:'dd/MM/aaaa', itens:[{descricao,item,quantidade}] }
 */
function gravarEmbarque(token, dados) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  dados = dados || {};
  var doc = parseInt(dados.doc, 10);
  if (!doc) throw new Error('Informe o número do embarque.');
  var data = _parseDataBR(dados.data);
  if (!data) throw new Error('Data do embarque inválida (use dd/mm/aaaa).');

  var itens = (dados.itens || []).filter(function (it) { return it.item && String(it.item).trim(); });
  if (!itens.length) throw new Error('Nenhum item válido para gravar. Resolva os itens pendentes.');

  // Aprende as descrições resolvidas (para reconhecer nas próximas vezes).
  _salvarMapaEmbarque(itens.map(function (it) {
    return { descricao: it.descricao, item: it.item };
  }));

  var sh = _aba(CONFIG.SHEETS.EMBARQUES, ['CORES', 'PESO', 'EMBARQUE', 'DATA', 'SITUAÇÃO']);
  var linhas = itens.map(function (it) {
    return [String(it.item).trim(), Number(it.quantidade) || 0, doc, data, ''];
  });
  sh.getRange(sh.getLastRow() + 1, 1, linhas.length, 5).setValues(linhas);
  return { ok: true, gravados: linhas.length };
}

/** dd/MM/aaaa → Date (local), ou null. */
function _parseDataBR(s) {
  var m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
}
