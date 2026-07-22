/**
 * NotaFioCru.gs
 * Importação de NF de fio crú a partir do arquivo da nota — por ora o XML da
 * NFe (padrão SEFAZ), que é confiável (tags fixas). O PDF (DANFE) fica pra
 * uma etapa futura, quando houver um exemplo real pra calibrar o layout.
 *
 * Fluxo (universal — não depende da unidade ativa):
 *   1. analisarNfFioCruXml(token, base64) → lê o XML, DESCOBRE a filial pelo
 *      CNPJ (entrega, senão destinatário — trata NF triangular) e devolve uma
 *      PRÉVIA: filial, dados da NF e os itens, cada um já com o tipo de fio
 *      associado (se a descrição da NF já foi ensinada antes) ou em branco.
 *   2. O usuário associa na tela as descrições ainda desconhecidas a um tipo
 *      de fio que já existe no estoque (das DUAS fábricas, pra manter a mesma
 *      grafia nas duas) — ou cadastra um tipo novo.
 *   3. gravarNfFioCruXml(token, params) → grava os lotes no estoque de fio crú
 *      da FILIAL detectada e MEMORIZA as associações novas (aprendizado).
 *
 * MAPA_FIO_CRU (descrição do produto na NF → tipo de fio do estoque) é
 * UNIVERSAL, igual à Associação Fio Crú: mora na planilha da unidade padrão,
 * porque a nomenclatura de fio é a mesma nas duas empresas (ensina uma vez,
 * vale pra todas — ver `_ssMapaFioCru`).
 */

/** Planilha do aprendizado de NF (universal — unidade padrão). */
function _ssMapaFioCru() {
  return _ss(CONFIG.getSpreadsheetId(CONFIG.UNIDADE_PADRAO));
}

/** Aprendizado: normalizado(descrição da NF) → tipo de fio do estoque. */
function _lerMapaFioCru() {
  var mapa = {};
  lerRegistros(CONFIG.SHEETS.MAPA_FIO_CRU, _ssMapaFioCru()).forEach(function (r) {
    var d = _norm(r.DESCRICAO_NF);
    if (d && r.TIPO_FIO !== '' && r.TIPO_FIO != null) mapa[d] = String(r.TIPO_FIO).trim();
  });
  return mapa;
}

/** Memoriza associações descrição da NF → tipo de fio, sem duplicar. */
function _salvarMapaFioCru(pares) {
  var ss = _ssMapaFioCru();
  var sh = _aba(CONFIG.SHEETS.MAPA_FIO_CRU, ['DESCRICAO_NF', 'TIPO_FIO'], ss);
  var existentes = _lerMapaFioCru();
  var novos = [];
  (pares || []).forEach(function (p) {
    var desc = String(p.descricaoNF || '').trim();
    var tipo = String(p.tipoFio || '').trim();
    if (!desc || !tipo) return;
    var k = _norm(desc);
    if (existentes[k]) return;
    existentes[k] = tipo;
    novos.push([desc, tipo]);
  });
  if (novos.length) sh.getRange(sh.getLastRow() + 1, 1, novos.length, 2).setValues(novos);
}

/* ----------------------------- leitura do XML ---------------------------- */

/** Primeiro descendente (ou o próprio) com aquele nome local, ignorando
 * namespace/prefixo (NFe usa namespace da SEFAZ). */
function _xmlPrimeiro(el, nome) {
  if (!el) return null;
  if (el.getName() === nome) return el;
  var ch = el.getChildren();
  for (var i = 0; i < ch.length; i++) {
    var r = _xmlPrimeiro(ch[i], nome);
    if (r) return r;
  }
  return null;
}

/** Todos os descendentes com aquele nome local (ignora namespace). */
function _xmlTodos(el, nome, acc) {
  acc = acc || [];
  if (!el) return acc;
  if (el.getName() === nome) acc.push(el);
  var ch = el.getChildren();
  for (var i = 0; i < ch.length; i++) _xmlTodos(ch[i], nome, acc);
  return acc;
}

/** Texto do primeiro descendente com aquele nome (ou '' ). */
function _xmlTexto(el, nome) {
  var e = _xmlPrimeiro(el, nome);
  return e ? String(e.getText()).trim() : '';
}

/** Decodifica o base64 do arquivo em texto (UTF-8; acentos não importam pro
 * casamento, que é normalizado sem acento). */
function _base64ParaTexto(base64) {
  return Utilities.newBlob(Utilities.base64Decode(base64)).getDataAsString('UTF-8');
}

/**
 * Lê um XML de NFe e devolve os dados crus:
 * { nf, dataIso, dataFmt, fornecedor, cnpjDest, cnpjEntrega, itens:[{descricao,quantidade,precoUnitario,unidade}] }
 */
function _parseNfeXml(xmlTexto) {
  var doc;
  try {
    doc = XmlService.parse(xmlTexto);
  } catch (e) {
    throw new Error('Arquivo XML inválido ou ilegível. Confira se é o XML da NFe.');
  }
  var root = doc.getRootElement();
  var inf = _xmlPrimeiro(root, 'infNFe');
  if (!inf) throw new Error('Não parece ser um XML de NFe (não achei infNFe).');

  var ide = _xmlPrimeiro(inf, 'ide');
  var emit = _xmlPrimeiro(inf, 'emit');
  var dest = _xmlPrimeiro(inf, 'dest');
  var entrega = _xmlPrimeiro(inf, 'entrega');
  var infAdic = _xmlPrimeiro(inf, 'infAdic');

  // Informações complementares (texto livre): em NF triangular ("remessa por
  // conta e ordem de"), a Marfim real (e seu CNPJ) aparece SÓ aqui — o
  // destinatário é a intermediária. Extraímos todos os CNPJs desse texto.
  var infCpl = infAdic ? _xmlTexto(infAdic, 'infCpl') : '';
  var cnpjsInfCpl = _extrairCnpjs(infCpl);

  var nf = ide ? _xmlTexto(ide, 'nNF') : '';
  var dataBruta = ide ? (_xmlTexto(ide, 'dhEmi') || _xmlTexto(ide, 'dEmi')) : '';
  var dataIso = dataBruta ? dataBruta.substring(0, 10) : ''; // 'yyyy-MM-dd'

  var itens = _xmlTodos(inf, 'det').map(function (det) {
    var prod = _xmlPrimeiro(det, 'prod');
    return {
      descricao: prod ? _xmlTexto(prod, 'xProd') : '',
      quantidade: prod ? (parseFloat(_xmlTexto(prod, 'qCom')) || 0) : 0,
      precoUnitario: prod ? (parseFloat(_xmlTexto(prod, 'vUnCom')) || 0) : 0,
      unidade: prod ? _xmlTexto(prod, 'uCom') : ''
    };
  }).filter(function (it) { return it.descricao; });

  return {
    nf: nf,
    dataIso: dataIso,
    dataFmt: dataIso ? (dataIso.substring(8, 10) + '/' + dataIso.substring(5, 7) + '/' + dataIso.substring(0, 4)) : '',
    fornecedor: emit ? _xmlTexto(emit, 'xNome') : '',
    cnpjDest: dest ? (_xmlTexto(dest, 'CNPJ') || _xmlTexto(dest, 'CPF')) : '',
    cnpjEntrega: entrega ? (_xmlTexto(entrega, 'CNPJ') || _xmlTexto(entrega, 'CPF')) : '',
    cnpjsInfCpl: cnpjsInfCpl,
    itens: itens
  };
}

/** Extrai CNPJs (só dígitos) de um texto livre — formatado (00.000.000/0000-00)
 * ou 14 dígitos seguidos. */
function _extrairCnpjs(texto) {
  texto = String(texto || '');
  var achados = {};
  var out = [];
  var re = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g;
  var m;
  while ((m = re.exec(texto)) !== null) {
    var d = m[0].replace(/\D/g, '');
    if (d.length === 14 && !achados[d]) { achados[d] = true; out.push(d); }
  }
  return out;
}

/* --------------------------- API (cliente) ------------------------------- */

/**
 * Lê o XML da NFe e devolve a prévia pra conferência/associação. Descobre a
 * filial pelo CNPJ (entrega primeiro — trata triangulação —, senão o
 * destinatário). NÃO grava nada.
 * @param {string} base64  conteúdo do XML em base64 (sem o prefixo data:)
 */
function analisarNfFioCruXml(token, base64, nome) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  if (!base64) throw new Error('Nenhum arquivo recebido.');

  var dados = _parseNfeXml(_base64ParaTexto(base64));
  if (!dados.nf) throw new Error('Não achei o número da NF no XML.');
  if (!dados.itens.length) throw new Error('Não achei itens (produtos) no XML.');

  // Prioridade: local de entrega (triangulação estruturada) → CNPJ citado nas
  // informações complementares ("remessa por conta e ordem de") → destinatário.
  var candidatos = [dados.cnpjEntrega].concat(dados.cnpjsInfCpl).concat([dados.cnpjDest]);
  var filialId = CONFIG.detectarUnidadePorCnpj(candidatos);
  if (!filialId) {
    var achado = candidatos.filter(function (c) { return c; }).join(' / ') || '(nenhum)';
    throw new Error(
      'Não consegui identificar a filial (Ceará/Bahia) pelos CNPJs da NF (encontrei: ' + achado + '). ' +
      'Se for uma filial nova, ajuste os CNPJs em Config (cnpjPadrao) ou nas Propriedades do script.'
    );
  }

  var mapa = _lerMapaFioCru();
  var itens = dados.itens.map(function (it) {
    return {
      descricao: it.descricao,
      quantidade: it.quantidade,
      precoUnitario: it.precoUnitario,
      unidade: it.unidade,
      tipoFio: mapa[_norm(it.descricao)] || '' // vazio = precisa associar
    };
  });

  // NF já lançada nessa filial? (avisa, não bloqueia — a gravação pula duplicatas)
  var jaLancada = false;
  try {
    lerRegistros(CONFIG.SHEETS.FIO_CRU_ENTRADAS, _ss(CONFIG.getSpreadsheetId(filialId))).forEach(function (r) {
      if (_normNumero(r.NF) === _normNumero(dados.nf)) jaLancada = true;
    });
  } catch (e) {}

  // Triangular = a filial detectada NÃO é o destinatário da nota (a
  // mercadoria vai pra Marfim, mas quem consta como destinatário é a
  // intermediária). Vale tanto pra <entrega> quanto pra "conta e ordem".
  var cnpjFilial = CONFIG.getCnpjUnidade(filialId);
  var triangular = !!(cnpjFilial && cnpjFilial !== String(dados.cnpjDest || '').replace(/\D/g, ''));

  return {
    ok: true,
    filialId: filialId,
    filialRotulo: CONFIG.getUnidadeInfo(filialId).rotulo,
    triangular: triangular,
    nf: dados.nf,
    fornecedor: dados.fornecedor,
    dataIso: dados.dataIso,
    dataFmt: dados.dataFmt,
    jaLancada: jaLancada,
    itens: itens,
    tiposFio: _listarTiposFioEstoqueTodasUnidades().sort(function (a, b) { return a.localeCompare(b); })
  };
}

/**
 * Grava os lotes da NF no estoque de fio crú da FILIAL informada (detectada na
 * análise) e memoriza as associações descrição→tipo de fio. Pula qualquer lote
 * [tipo de fio + NF] que já exista (idempotente — reimportar não duplica).
 * @param {Object} params { filialId, nf, fornecedor, dataIso, itens:[{descricao,tipoFio,quantidade,precoUnitario}] }
 * @return {Object} { ok, filialRotulo, lancados, jaExistiam }
 */
function gravarNfFioCruXml(token, params) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  params = params || {};
  var filialId = String(params.filialId || '').trim();
  CONFIG.getUnidadeInfo(filialId); // valida (lança erro se inválida)

  var nf = String(params.nf || '').trim();
  if (!nf) throw new Error('NF sem número.');
  var data = _parseDataISO(params.dataIso);
  if (!data) throw new Error('Data da NF inválida.');
  var fornecedor = String(params.fornecedor || '').trim();

  var itens = (params.itens || []).map(function (it) {
    return {
      descricao: String(it.descricao || '').trim(),
      tipoFio: String(it.tipoFio || '').trim(),
      quantidade: Number(it.quantidade) || 0,
      precoUnitario: Number(it.precoUnitario) || 0
    };
  }).filter(function (it) { return it.quantidade > 0; });
  if (!itens.length) throw new Error('Nenhum item com quantidade para lançar.');

  var semTipo = itens.filter(function (it) { return !it.tipoFio; });
  if (semTipo.length) {
    throw new Error(semTipo.length + ' item(ns) ainda sem tipo de fio associado. Associe todos antes de gravar.');
  }

  // Aprende as associações novas (universal) antes de gravar.
  _salvarMapaFioCru(itens.map(function (it) {
    return { descricaoNF: it.descricao, tipoFio: it.tipoFio };
  }));

  // Grava no estoque da FILIAL detectada (não na unidade ativa da sessão).
  _definirUnidadeAtiva(filialId);
  var sh = _prepararFioCruEntradas();
  var existentes = {};
  _lerLotesFioCru().forEach(function (l) { existentes[l.chave] = true; });

  var novas = [], jaExistiam = 0;
  itens.forEach(function (it) {
    var chave = _chaveLoteFioCru(it.tipoFio, nf);
    if (existentes[chave]) { jaExistiam++; return; }
    existentes[chave] = true;
    novas.push(_linhaFioCruEntrada({
      tipoFio: it.tipoFio, nf: nf, fornecedor: fornecedor,
      quantidade: it.quantidade, precoUnitario: it.precoUnitario, data: data
    }));
  });
  if (novas.length) {
    sh.getRange(sh.getLastRow() + 1, 1, novas.length, FIO_CRU_ENTRADAS_HEADERS.length).setValues(novas);
  }

  return {
    ok: true,
    filialRotulo: CONFIG.getUnidadeInfo(filialId).rotulo,
    lancados: novas.length,
    jaExistiam: jaExistiam
  };
}
