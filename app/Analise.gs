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

/**
 * Colunas da relação de compra (contrato com a interface e o banco;
 * compartilhado pelas duas abas abaixo — mesmo formato nas duas).
 *
 * O fluxo tem DUAS abas com papéis diferentes:
 *   - PENDENCIA_COMPRA: rascunho de trabalho. Cada "Prosseguir com a
 *     compra" ACRESCENTA itens aqui (não substitui) — é daqui que o
 *     tingimento vai trabalhando aos poucos (nem sempre dá conta de tudo de
 *     uma vez), possivelmente ao longo de vários dias, ANTES de qualquer
 *     e-mail ser enviado. Zerar é uma ação explícita do master
 *     (excluirRelacaoDeCompra).
 *   - RELACAO_COMPRA: histórico definitivo. SÓ recebe linha quando o
 *     e-mail do Pedido de Fio é EFETIVAMENTE enviado (enviarRelatorioCompra,
 *     em Consultas.gs) — nesse momento os itens saem de PENDENCIA_COMPRA
 *     (que é limpa) e são arquivados aqui com STATUS ENVIADO. Não tem botão
 *     de excluir: é um log, não um rascunho.
 */
var RELACAO_COMPRA_HEADERS = [
  'ITEM',          // código do produto/cor
  'DESCRICAO',     // referência que identifica o item para o usuário
  'CLIENTE',       // cliente vinculado (produção, coluna N)
  'TIPO_FIO',      // tipo de fio (poliéster, brilhante, reciclado/pet...)
  'SALDO',         // saldo final (último lançamento do item)
  'EM_VIAGEM',     // embarcado e ainda não chegado (aba EMBARQUES, sem "chegou")
  'ESTOQUE_ENCONTRADO', // contagem avulsa digitada na análise (fora de qualquer controle)
  'CONSUMO_MEDIO', // consumo médio mensal (saídas dos últimos 3 meses ÷ 3)
  'MAQUINAS',      // máquinas de tingimento escolhidas (ex.: "80 + 27")
  'SUGERIDO',      // total do tingimento em kg (soma das máquinas)
  'DATA_LIMITE',   // data limite de embarque (PRIORIDADES DE FIO)
  'OBS',           // observação digitada no painel de tingimento
  'EM_ABERTO',     // já solicitado e ainda não recebido
  'A_COMPRAR',     // diferença final a pedir (SUGERIDO - EM_ABERTO)
  'STATUS',        // em PENDENCIA_COMPRA: ABERTO (aguardando envio). Em RELACAO_COMPRA: ENVIADO.
  'GERADO_EM'      // data/hora em que este pedido foi gerado
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
  // da produção antes de montar a lista (para já saírem com descrição). O
  // nome gravado é um palpite (_transformarFio); a tela mostra esses itens
  // pro master conferir/corrigir (ver `novosItens` na resposta).
  var registro = registrarItensNovos(token);
  var novosCadastrados = registro.adicionados;

  // Concilia embarques: marca "CHEGOU" quando o item já foi lançado na aba
  // ESTOQUE dentro do período (evita contar a mesma mercadoria duas vezes),
  // e soma o que ainda está em viagem para cada item.
  var chegadas = _atualizarChegadasEmbarque(inicio, fim);
  var emViagemPorItem = _emViagemPorItem();
  // Itens do mesmo embarque que ficaram para trás (outros já chegaram, este não):
  // vão para a aba de pendências, para o master acompanhar.
  var pendencias = _atualizarPendenciasEmbarque();

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
      porItem[chave] = { item: String(mov.item).trim(), ultimo: null, saldo: 0, obsEstoque: '', noPeriodo: false, saidas3m: 0 };
    }
    var reg = porItem[chave];

    // saldo final = saldo do lançamento mais recente do item (e a OBS desse mesmo lançamento)
    if (!reg.ultimo || mov.data.getTime() > reg.ultimo.getTime()) {
      reg.ultimo = mov.data;
      reg.saldo = mov.saldo;
      reg.obsEstoque = mov.obs;
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
    var emViagem = emViagemPorItem[k] || 0;
    var saldoAjustado = r.saldo + emViagem; // considera o que já está a caminho, para não pedir compra à toa
    var t = tingimentoDe(r.item, saldoAjustado, media);
    itens.push({
      item: r.item,
      descricao: d.descricao,
      cliente: d.cliente,
      motivo: d.motivo,
      saldo: r.saldo,
      obsEstoque: r.obsEstoque,
      emViagem: emViagem,
      estoqueEncontrado: 0,
      consumoMedio: media,
      tipoFio: t.tipoFio,
      alvo: t.alvo,
      maquinas: t.maquinas.join(' + '),
      totalTingimento: t.total,
      dataLimite: dataLimiteDe(r.item)
    });
  });
  // Itens de fio primeiro (do saldo menor para o maior, mais críticos primeiro);
  // dentro dos fios, os já bem abastecidos (saldo > consumo médio — não
  // precisam de compra por ora) ficam agrupados no fim do grupo de fios;
  // os que não são fio (sem tipo de fio identificado) ficam por último de todos.
  itens.sort(function (a, b) {
    var ra = _rankPrioridadeCompra(a), rb = _rankPrioridadeCompra(b);
    if (ra !== rb) return ra - rb;
    return (Number(a.saldo) + Number(a.emViagem)) - (Number(b.saldo) + Number(b.emViagem));
  });

  var msg = itens.length
    ? itens.length + ' item(ns) lançado(s) no período.'
    : 'Nenhum item teve lançamento no período informado.';
  if (novosCadastrados > 0) {
    msg += ' ' + novosCadastrados + ' item(ns) novo(s) cadastrado(s) automaticamente na ASSOCIAÇÃO.';
  }
  if (chegadas.marcados > 0) {
    msg += ' ' + chegadas.marcados + ' embarque(s) confirmado(s) como chegado(s) no período (não contam mais como em viagem).';
  }
  if (pendencias.pendentes > 0) {
    msg += ' Atenção: ' + pendencias.pendentes + ' item(ns) de embarques parcialmente lançados ' +
      'ficaram em pendência (veja abaixo).';
  }
  return {
    ok: true, itens: itens, novosCadastrados: novosCadastrados,
    novosItens: registro.itens || [], mensagem: msg,
    pendencias: pendencias.linhas
  };
}

/**
 * Reconsulta a DATA LIMITE DE EMBARQUE de UM item, direto da aba PEDIDO DE FIO
 * — sem rodar a análise inteira de novo. Essa data vem de outra planilha
 * (PRIORIDADES DE FIO) e pode ser alterada por alguém enquanto a lista já
 * analisada continua aberta na tela; o botão de atualizar (na Análise de
 * Compra) chama esta função para trazer só o valor mais recente daquele item.
 * @return {Object} { ok, dataLimite: 'dd/MM/aaaa' | '' }
 */
function consultarDataLimiteItem(token, item) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  item = String(item == null ? '' : item).trim();
  if (!item) throw new Error('Informe o item.');
  var dataLimiteDe = _criarLocalizadorDataLimite();
  return { ok: true, dataLimite: dataLimiteDe(item) };
}

/**
 * Reconsulta, na hora, o pedido de tingimento (máquinas/total) de UM item
 * somando o "estoque encontrado" (contagem avulsa, digitada manualmente na
 * Análise de Compra para um valor que apareceu mas não está em nenhum
 * controle já implementado) ao saldo + em viagem — sem rodar a análise
 * inteira de novo. Recalcula a necessidade de compra em tempo real.
 * @param {Object} params { item, saldo, emViagem, estoqueEncontrado, consumoMedio }
 * @return {Object} { ok, tipoFio, maquinas, totalTingimento }
 */
function recalcularTingimentoItem(token, params) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  params = params || {};
  var item = String(params.item || '').trim();
  if (!item) throw new Error('Informe o item.');

  var saldo = Number(params.saldo) || 0;
  var emViagem = Number(params.emViagem) || 0;
  var estoqueEncontrado = Number(params.estoqueEncontrado) || 0;
  var media = Number(params.consumoMedio) || 0;
  var saldoAjustado = saldo + emViagem + estoqueEncontrado;

  var tingimentoDe = _criarCalculadoraTingimento();
  var t = tingimentoDe(item, saldoAjustado, media);
  return { ok: true, tipoFio: t.tipoFio, maquinas: t.maquinas.join(' + '), totalTingimento: t.total };
}

/**
 * ETAPA 2 — Recebe os itens que o master manteve (após excluir os indesejados)
 * e grava no rascunho pendente (PENDENCIA_COMPRA) — ainda não é o histórico
 * definitivo, isso só acontece quando o e-mail é de fato enviado (ver
 * `enviarRelatorioCompra`, em Consultas.gs).
 *
 * Por item (código), é um UPSERT, não um "sempre acrescenta": se aquele
 * código já está pendente (de uma geração anterior, ainda não enviada),
 * a linha existente é SUBSTITUÍDA pelos valores novos — corrige em vez de
 * duplicar. Só vira linha nova o código que ainda não estava pendente.
 * Isso permite achar um erro na tela de Tingimento, voltar pra Análise,
 * ajustar e gerar de novo sem empilhar pedidos repetidos do mesmo item.
 *
 * @param {string} token
 * @param {Object} params { itens: [{item, descricao, saldo, consumoMedio}] }
 */
function gerarRelacaoDeCompra(token, params) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  params = params || {};
  var itens = params.itens || [];
  if (!itens.length) throw new Error('Nenhum item selecionado para a compra.');

  var agora = new Date();
  var sh = _prepararAbaCompra(CONFIG.SHEETS.PENDENCIA_COMPRA);

  // Linha atual (se houver) de cada código já pendente, pra decidir
  // substituir em vez de duplicar.
  var linhaPorItem = {};
  lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA).forEach(function (r) {
    var k = _norm(r.ITEM);
    if (k) linhaPorItem[k] = r.__row;
  });

  // EM_ABERTO/A_COMPRAR ficam vazios por ora (uso futuro); STATUS nasce ABERTO.
  var novas = [];
  var substituidas = 0;
  itens.forEach(function (it) {
    var linha = [
      it.item || '',
      it.descricao || '',
      it.cliente || '',
      it.tipoFio || '',
      it.saldo != null ? it.saldo : '',
      it.emViagem != null ? it.emViagem : '',
      it.estoqueEncontrado ? it.estoqueEncontrado : '', // ESTOQUE_ENCONTRADO
      it.consumoMedio != null ? it.consumoMedio : '',
      it.maquinas || '',
      it.totalTingimento != null ? it.totalTingimento : '',
      it.dataLimite || '',      // DATA_LIMITE
      it.obs || '',             // OBS (pode já vir editada na análise)
      '',                       // EM_ABERTO (pedidos em aberto)
      '',                       // A_COMPRAR
      'ABERTO',                 // STATUS
      agora                     // GERADO_EM
    ];
    var linhaExistente = linhaPorItem[_norm(it.item)];
    if (linhaExistente) {
      sh.getRange(linhaExistente, 1, 1, RELACAO_COMPRA_HEADERS.length).setValues([linha]);
      substituidas++;
    } else {
      novas.push(linha);
    }
  });
  if (novas.length) {
    sh.getRange(sh.getLastRow() + 1, 1, novas.length, RELACAO_COMPRA_HEADERS.length).setValues(novas);
  }

  var partes = [];
  if (novas.length) partes.push(novas.length + ' item(ns) novo(s)');
  if (substituidas) partes.push(substituidas + ' item(ns) corrigido(s) (já estava(m) pendente(s))');
  return {
    ok: true,
    mensagem: partes.join(' e ') + ' na relação de compra pendente. Envie por e-mail na tela de ' +
      'Tingimento para confirmar — só aí entra no histórico definitivo.'
  };
}

/**
 * Carrega o rascunho pendente (itens já selecionados, ainda não enviados).
 */
function obterRelacaoDeCompra(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  var registros = lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA);
  return { ok: true, colunas: RELACAO_COMPRA_HEADERS, linhas: registros };
}

/**
 * Apaga TODO o rascunho pendente e começa do zero. Ação explícita do
 * master — o rascunho nunca se apaga sozinho ao gerar uma nova compra.
 * Não afeta RELACAO_COMPRA (histórico definitivo, já enviado — esse não
 * tem como excluir por aqui).
 */
function excluirRelacaoDeCompra(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  reescreverAba(CONFIG.SHEETS.PENDENCIA_COMPRA, RELACAO_COMPRA_HEADERS, []);
  return { ok: true, mensagem: 'Relação de compra pendente excluída. Gere uma nova compra para começar do zero.' };
}

/**
 * Confere se o cabeçalho da aba (PENDENCIA_COMPRA ou RELACAO_COMPRA) já
 * existente bate com RELACAO_COMPRA_HEADERS (a estrutura pode ter ganhado
 * coluna nova desde a última vez que a aba foi criada). Se não bater e já
 * houver dados gravados, recusa (para não desalinhar linhas antigas com
 * colunas novas). Se não houver dados ainda, corrige o cabeçalho sozinho.
 */
function _prepararAbaCompra(nomeAba) {
  var sh = _aba(nomeAba, RELACAO_COMPRA_HEADERS);
  var largura = sh.getLastColumn();
  var atuais = largura ? sh.getRange(1, 1, 1, largura).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var igual = atuais.length === RELACAO_COMPRA_HEADERS.length &&
    atuais.every(function (h, i) { return h === RELACAO_COMPRA_HEADERS[i]; });
  if (igual) return sh;

  if (sh.getLastRow() > 1) {
    throw new Error(
      'A estrutura da aba ' + nomeAba + ' mudou (ganhou coluna nova) e já existem dados no formato ' +
      'antigo. Para não misturar dados incompatíveis, ' +
      (nomeAba === CONFIG.SHEETS.PENDENCIA_COMPRA
        ? 'exclua o relatório pendente ("Excluir relatório e começar do zero", na Análise de Compra) '
        : 'corrija o cabeçalho dessa aba manualmente ') +
      'antes de continuar.'
    );
  }
  // Ainda sem dados: pode corrigir o cabeçalho com segurança.
  sh.getRange(1, 1, 1, RELACAO_COMPRA_HEADERS.length).setValues([RELACAO_COMPRA_HEADERS])
    .setFontWeight('bold').setBackground('#0F5FA0').setFontColor('#FFFFFF');
  if (largura > RELACAO_COMPRA_HEADERS.length) {
    sh.getRange(1, RELACAO_COMPRA_HEADERS.length + 1, 1, largura - RELACAO_COMPRA_HEADERS.length).clearContent();
  }
  return sh;
}

/* ------------------------------ auxiliares ----------------------------- */

/**
 * Prioridade de compra de um item, para ordenar a lista da Análise:
 *   0 = fio que precisa de atenção (saldo ≤ consumo médio)
 *   1 = fio já bem abastecido (saldo > consumo médio) — agrupado no fim dos fios
 *   2 = não é fio (sem tipo de fio identificado) — sempre por último
 * "saldo" aqui já inclui o que está em viagem e o estoque encontrado
 * (mesmo critério usado no realce da tela — ver `reaplicarDestaque`).
 */
function _rankPrioridadeCompra(it) {
  if (!it.tipoFio) return 2;
  var saldoEfetivo = Number(it.saldo) + Number(it.emViagem || 0) + Number(it.estoqueEncontrado || 0);
  return saldoEfetivo > Number(it.consumoMedio) ? 1 : 0;
}

/**
 * Lê a aba ESTOQUE e devolve uma lista de movimentos
 * { item, data, entrada, saida, saldo, obs }. As colunas são localizadas
 * pelo nome do cabeçalho (sem depender de acentos, maiúsculas ou posição).
 */
function _lerEstoque() {
  var sh = _aba(CONFIG.SHEETS.ESTOQUE);
  if (!sh) throw new Error('Aba "ESTOQUE" não encontrada na planilha.');
  var last = sh.getLastRow();
  if (last < 2) return [];

  var valores = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
  var header = valores.shift().map(_norm);
  // Aceita tanto o cabeçalho do Ceará (Item/Data/Saldo/Obs) quanto o da Bahia
  // (Descrição/Data Lançamento/Saldo de Estoque/Observações) — mesma aba,
  // duas convenções de nome herdadas de scripts diferentes.
  var iItem = _colPorNomes(header, ['item', 'descricao']);
  var iData = _colPorNomes(header, ['data', 'data lancamento']);
  var iEntrada = _colPorNomes(header, ['entrada']);
  var iSaida = _colPorNomes(header, ['saida']);   // "Saída" → "saida"
  var iSaldo = _colPorNomes(header, ['saldo', 'saldo de estoque']);
  var iObs = _colPorNomes(header, ['obs', 'observacoes']);
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
      saldo: parseFloat(r[iSaldo]) || 0,
      obs: iObs >= 0 ? (r[iObs] == null ? '' : String(r[iObs]).trim()) : ''
    });
  });
  return out;
}

/**
 * Cria o localizador de descrição de item, reproduzindo a fórmula da coluna E
 * (REFERENCIA) de PEDIDO DE FIO:
 *   código → ASSOCIAÇÃO (procura em B..G → devolve A)
 *          → PEDIDO DE FIO (procura A em O → devolve M = descrição da produção).
 * Devolve uma função descricao(codigo) → string ('' quando não há cadastro).
 * (Validado contra a planilha real: reproduz 44/44 as descrições da coluna E.)
 *
 * Um mesmo valor normalizado pode aparecer em MAIS de uma linha/coluna da
 * ASSOCIAÇÃO (códigos crus diferentes que caem no mesmo nome padrão) — só
 * UM desses códigos crus costuma ter pedido de produção (coluna O)
 * conhecido. Por isso guarda TODOS os candidatos (coluna A) por valor
 * normalizado, em vez de só o primeiro achado, e tenta cada um até achar
 * correspondência em PEDIDO DE FIO — reproduz o mesmo critério de
 * `BUSCAR_PEDIDO_M`/`BUSCAR_PEDIDO_N` (que também varrem várias colunas e
 * testam todos os candidatos, não só o primeiro).
 */
function _criarLocalizadorDescricao() {
  // ASSOCIAÇÃO: normalizado(B..G) → lista de valores da coluna A que batem.
  var COLS_ASSOC = 6; // B,C,D,E,F,G
  var assocMaps = [];
  for (var m = 0; m < COLS_ASSOC; m++) assocMaps.push({});
  var shA = _aba(CONFIG.SHEETS.ASSOCIACAO);
  if (shA && shA.getLastRow() > 1) {
    var largura = Math.min(shA.getLastColumn(), COLS_ASSOC + 1);
    if (largura > 1) {
      var va = shA.getRange(2, 1, shA.getLastRow() - 1, largura).getValues();
      va.forEach(function (row) {
        var a = row[0];
        if (a === '' || a == null) return;
        for (var c = 1; c < largura; c++) {
          var k = _norm(row[c]);
          if (!k) continue;
          if (!assocMaps[c - 1][k]) assocMaps[c - 1][k] = [];
          if (assocMaps[c - 1][k].indexOf(a) === -1) assocMaps[c - 1][k].push(a);
        }
      });
    }
  }
  // PEDIDO DE FIO: normalizado(O) → { descrição (M), cliente (N) }
  var oInfo = {};
  var shP = _aba(CONFIG.SHEETS.PEDIDO_FIO);
  if (shP && shP.getLastRow() > 1) {
    var vp = shP.getRange(1, 13, shP.getLastRow(), 3).getValues(); // colunas M, N, O
    vp.forEach(function (row) {
      var o = _norm(row[2]); // O
      var m2 = row[0];       // M (descrição)
      var n = row[1];        // N (cliente)
      if (o && m2 !== '' && m2 != null && !(o in oInfo)) {
        oInfo[o] = { descricao: String(m2).trim(), cliente: (n == null ? '' : String(n).trim()) };
      }
    });
  }
  return function (codigo) {
    var vl = _norm(codigo);
    if (!vl) return { descricao: '', cliente: '', motivo: '' };
    var achouAssoc = false;
    for (var i = 0; i < assocMaps.length; i++) {
      var candidatos = assocMaps[i][vl];
      if (!candidatos) continue;
      achouAssoc = true;
      for (var j = 0; j < candidatos.length; j++) {
        var cod = _norm(candidatos[j]);
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
