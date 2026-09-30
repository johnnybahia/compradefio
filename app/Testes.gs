/**
 * Testes.gs
 * Testes de fumaça (smoke tests) — rodados NA MÃO pelo editor do Apps
 * Script: menu "Selecionar função" → escolher `testarIdLinhaFioCruCeara`
 * (ou `...Bahia`) → Executar → ver o "Log de execução" (Ctrl+Enter). Não
 * precisa de login/sessão, roda direto como qualquer função do editor.
 *
 * IMPORTANTE: não existe um ambiente separado (sandbox) no Apps Script — o
 * teste grava e apaga linhas de verdade na SUA planilha real, sempre bem
 * marcadas com prefixo "TESTE_IDLINHA_" e SEMPRE removidas ao final (mesmo
 * se alguma verificação falhar — ver o `finally`). Se a execução for
 * interrompida no meio por algum motivo raro (timeout do Apps Script, queda
 * de conexão), pode sobrar lixo marcado com esse prefixo — procure e apague
 * na mão; nunca aparece em relatório nenhum porque não é um item/NF real.
 *
 * Cobre a correção do ID_LINHA (ver FioCru.gs, Embarque.gs): simula EXATAMENTE
 * o cenário reportado — dois "pedidos" com o MESMO código de item, cada um
 * com sua própria baixa — e confere que um não contamina o outro. NÃO testa
 * o fluxo inteiro de Confirmar Embarque (isso manda e-mail de verdade e avança
 * o número do embarque — não dá pra automatizar com segurança); pra isso,
 * ainda vale testar clicando na tela mesmo, com um item de teste.
 */
var TESTE_IDLINHA_PREFIXO = 'TESTE_IDLINHA_';

function testarIdLinhaFioCruCeara() { return _testarIdLinhaFioCru('CEARA'); }
function testarIdLinhaFioCruBahia() { return _testarIdLinhaFioCru('BAHIA'); }

function _testarIdLinhaFioCru(unidadeId) {
  _definirUnidadeAtiva(unidadeId);

  var relatorio = { unidade: unidadeId, ok: true, checks: [] };
  function check(nome, condicao, detalhe) {
    var linha = (condicao ? 'OK   ' : 'FALHOU ') + nome + (detalhe ? ' — ' + detalhe : '');
    relatorio.checks.push({ nome: nome, ok: !!condicao, detalhe: detalhe || '' });
    if (!condicao) relatorio.ok = false;
    Logger.log(linha);
  }

  var limpeza = []; // funções de limpeza — rodam TODAS no finally, mesmo se o teste falhar no meio
  try {
    var tipoFioTeste = TESTE_IDLINHA_PREFIXO + 'TIPO';
    var nfTeste = TESTE_IDLINHA_PREFIXO + 'NF';
    var itemTeste = TESTE_IDLINHA_PREFIXO + 'ITEM_DUPLICADO';
    var usuarioTeste = TESTE_IDLINHA_PREFIXO + 'usuario';

    Logger.log('=== Teste ID_LINHA (fio crú) — unidade ' + unidadeId + ' ===');
    Logger.log('Cenário: item "' + itemTeste + '" em DOIS pedidos abertos ao mesmo tempo — ' +
      'igual ao caso real reportado ("2427 30-2" em dois pedidos simultâneos).');

    // 1) Lote de fio crú FAKE, com saldo de sobra — não interfere em nenhum
    // tipo de fio real (nome sem chance de bater por "contém", ver `_tipoFioBate`).
    // `_prepararFioCruEntradas`/`_prepararAbaCompra` garantem que TODAS as
    // colunas do cabeçalho atual existem antes de gravar — sem isso,
    // `acrescentarRegistro` grava só o que já existe na planilha e o ID_LINHA
    // do teste (abaixo) sumiria em silêncio numa planilha desatualizada.
    _prepararFioCruEntradas();
    var linhaEntrada = acrescentarRegistro(CONFIG.SHEETS.FIO_CRU_ENTRADAS, {
      TIPO_FIO: tipoFioTeste, NF: nfTeste, FORNECEDOR: 'TESTE', QUANTIDADE: 1000,
      PRECO_UNITARIO: 1, DATA: new Date(), SITUACAO: '', INICIO_BAIXA: '',
      EDITADO_EM: '', EDITADO_POR: ''
    }, FIO_CRU_ENTRADAS_HEADERS);
    limpeza.push(function () { _testeExcluirLinha(CONFIG.SHEETS.FIO_CRU_ENTRADAS, linhaEntrada); });

    // 2) DUAS linhas de PENDENCIA_COMPRA abertas com o MESMO código de item —
    // o cenário exato do bug (pedido A precisa de 30kg, pedido B de 20kg).
    var idLinhaA = Utilities.getUuid();
    var idLinhaB = Utilities.getUuid();
    _prepararAbaCompra(CONFIG.SHEETS.PENDENCIA_COMPRA);
    var linhaA = acrescentarRegistro(CONFIG.SHEETS.PENDENCIA_COMPRA, {
      ITEM: itemTeste, DESCRICAO: 'teste automatizado', CLIENTE: 'TESTE A', TIPO_FIO: tipoFioTeste,
      STATUS: 'ABERTO', GERADO_EM: new Date(), ID_LINHA: idLinhaA, SUGERIDO: 30
    }, RELACAO_COMPRA_HEADERS);
    limpeza.push(function () { _testeExcluirLinha(CONFIG.SHEETS.PENDENCIA_COMPRA, linhaA); });
    var linhaB = acrescentarRegistro(CONFIG.SHEETS.PENDENCIA_COMPRA, {
      ITEM: itemTeste, DESCRICAO: 'teste automatizado', CLIENTE: 'TESTE B', TIPO_FIO: tipoFioTeste,
      STATUS: 'ABERTO', GERADO_EM: new Date(), ID_LINHA: idLinhaB, SUGERIDO: 20
    }, RELACAO_COMPRA_HEADERS);
    limpeza.push(function () { _testeExcluirLinha(CONFIG.SHEETS.PENDENCIA_COMPRA, linhaB); });
    // Baixas de fio crú geradas por este teste — limpa todas de uma vez pelo
    // ITEM (mais robusto que guardar número de linha: uma baixa pode virar
    // 2+ linhas se cruzar de lote, ver `_baixarFioCruSemLock`).
    limpeza.push(function () { _testeExcluirBaixasDoItem(itemTeste); });

    // 3) Simula a tela "Quantidade Tingida" lançando cada pedido separado —
    // exatamente como `registrarQuantidadeTingida` faz.
    var baixaA = _baixarFioCru(tipoFioTeste, 30, itemTeste, usuarioTeste, idLinhaA);
    check('baixa do pedido A (30kg) foi aceita', baixaA.ok, baixaA.mensagem || '');
    var baixaB = _baixarFioCru(tipoFioTeste, 20, itemTeste, usuarioTeste, idLinhaB);
    check('baixa do pedido B (20kg) foi aceita', baixaB.ok, baixaB.mensagem || '');

    // 4) O NÚCLEO do teste: "já tingido" de cada pedido tem que ver SÓ a sua
    // própria baixa — nunca a soma dos dois (era o bug: a tela mostrava o
    // mesmo "já tingido" combinado nas duas linhas).
    var tingidoMapa = _tingidoPorItem();
    var tingidoA = _tingidoDaLinha(tingidoMapa, idLinhaA, itemTeste);
    var tingidoB = _tingidoDaLinha(tingidoMapa, idLinhaB, itemTeste);
    check('"já tingido" do pedido A = 30 (não 50)', tingidoA === 30, 'veio ' + tingidoA);
    check('"já tingido" do pedido B = 20 (não 50)', tingidoB === 20, 'veio ' + tingidoB);

    // 5) "Consumo no estoque de fio crú" (tabela do PDF de Confirmação de
    // Embarque) também tem que sair separado por pedido.
    var consumoA = (_consumoCruPorItens([{ item: itemTeste, idLinha: idLinhaA }])[idLinhaA] || []);
    var consumoB = (_consumoCruPorItens([{ item: itemTeste, idLinha: idLinhaB }])[idLinhaB] || []);
    var pesoA = consumoA.reduce(function (acc, l) { return acc + (Number(l.peso) || 0); }, 0);
    var pesoB = consumoB.reduce(function (acc, l) { return acc + (Number(l.peso) || 0); }, 0);
    check('consumo de fio crú do pedido A = 30kg (não 50)', Math.abs(pesoA - 30) < 0.001, 'veio ' + pesoA);
    check('consumo de fio crú do pedido B = 20kg (não 50)', Math.abs(pesoB - 20) < 0.001, 'veio ' + pesoB);
    check('NF do lote fake aparece no consumo do pedido A', consumoA.length > 0 && consumoA[0].nf === nfTeste,
      consumoA.length ? ('veio NF ' + consumoA[0].nf) : 'lista vazia');

    // 6) Tipo de fio, baseline e liberado — as três funções que antes só
    // enxergavam a PRIMEIRA linha com aquele código (ignorando a segunda).
    check('tipo de fio do pedido A resolvido', !!_tipoFioDoItemPendente(itemTeste, idLinhaA));
    check('tipo de fio do pedido B resolvido', !!_tipoFioDoItemPendente(itemTeste, idLinhaB));
    check('baseline do pedido A = 0 (linha nova)', _baselineTingidoDoItemPendente(itemTeste, idLinhaA) === 0);
    check('liberado do pedido A = 0 (nada liberado ainda)', _liberadoDoItemPendente(itemTeste, idLinhaA) === 0);

    // 7) Prova de que o fallback por texto (baixas antigas, sem ID_LINHA —
    // como as gravadas antes desta correção existir) continua funcionando,
    // MAS fica isolado: não entra na conta dos pedidos A/B, que já têm
    // ID_LINHA. Sem isso, uma baixa legada podia inflar o "já tingido" de um
    // pedido que nada tem a ver com ela.
    var baixaLegada = _baixarFioCru(tipoFioTeste, 15, itemTeste, usuarioTeste, ''); // idLinha vazio de propósito
    check('baixa "legada" (sem idLinha, simulando dado antigo) foi aceita', baixaLegada.ok, baixaLegada.mensagem || '');
    var tingidoMapa2 = _tingidoPorItem();
    check('pedido A continua em 30kg mesmo com baixa legada no mesmo código de item',
      _tingidoDaLinha(tingidoMapa2, idLinhaA, itemTeste) === 30,
      'veio ' + _tingidoDaLinha(tingidoMapa2, idLinhaA, itemTeste));
    check('pedido B continua em 20kg mesmo com baixa legada no mesmo código de item',
      _tingidoDaLinha(tingidoMapa2, idLinhaB, itemTeste) === 20,
      'veio ' + _tingidoDaLinha(tingidoMapa2, idLinhaB, itemTeste));
    check('a baixa legada (15kg) foi pro fallback por texto, sozinha',
      (tingidoMapa2.porTexto[_norm(itemTeste)] || 0) === 15,
      'veio ' + (tingidoMapa2.porTexto[_norm(itemTeste)] || 0));

  } catch (e) {
    relatorio.ok = false;
    relatorio.erro = e.message;
    Logger.log('ERRO NO TESTE (execução interrompida): ' + e.message);
  } finally {
    // Limpa TUDO, na ordem inversa de criação — roda sempre, teste tendo
    // passado ou não. Cada limpeza é isolada (uma falhando não impede as outras).
    limpeza.reverse().forEach(function (fn) {
      try { fn(); } catch (e2) { Logger.log('Aviso: falha ao limpar dado de teste — ' + e2.message); }
    });
    Logger.log('Dados de teste removidos.');
  }

  Logger.log(relatorio.ok
    ? '=== TESTE PASSOU: a correção do ID_LINHA está funcionando (unidade ' + unidadeId + ') ==='
    : '=== TESTE FALHOU — confira os itens "FALHOU" acima antes de confiar na correção (unidade ' + unidadeId + ') ===');
  return relatorio;
}

/** Apaga uma linha de teste pelo número — usado quando se sabe exatamente
 * qual linha foi criada (entrada de fio crú, pendência). */
function _testeExcluirLinha(nomeAba, numeroLinha) {
  if (!numeroLinha) return;
  var sh = _aba(nomeAba, null);
  if (sh) sh.deleteRow(numeroLinha);
}

/** Apaga todas as linhas de FIO_CRU_BAIXAS geradas por este teste, pelo
 * ITEM — mais robusto que guardar números de linha (uma baixa pode virar
 * 2+ linhas se cruzar de um lote pro outro). De baixo pra cima, pra apagar
 * uma linha não bagunçar o número das próximas. */
function _testeExcluirBaixasDoItem(itemTeste) {
  var linhas = _lerBaixasFioCru()
    .filter(function (r) { return _norm(r.ITEM) === _norm(itemTeste); })
    .map(function (r) { return r.__row; })
    .sort(function (a, b) { return b - a; });
  if (!linhas.length) return;
  var sh = _aba(CONFIG.SHEETS.FIO_CRU_BAIXAS, null);
  if (!sh) return;
  linhas.forEach(function (row) { sh.deleteRow(row); });
}

/**
 * Teste de fumaça da lista "NFs Zeradas (Fio Crú)" — NÃO acessa planilha nenhuma
 * (roda `_nfsZeradasPorTipo` em cima de lotes inventados), então não grava nem
 * apaga nada: pode rodar à vontade. Cobre também a regra da ÚLTIMA NF do tipo
 * (a que não pode ser encerrada). Executar pelo editor: escolher
 * `testarNfsZeradasFioCru` → Executar → ver o "Log de execução".
 */
function testarNfsZeradasFioCru() {
  var relatorio = { ok: true, checks: [] };
  function check(nome, condicao, detalhe) {
    Logger.log((condicao ? 'OK   ' : 'FALHOU ') + nome + (!condicao && detalhe ? ' — veio ' + detalhe : ''));
    relatorio.checks.push({ nome: nome, ok: !!condicao, detalhe: detalhe || '' });
    if (!condicao) relatorio.ok = false;
  }
  var linhaSeq = 1;
  function lote(tipoFio, nf, data, quantidade, saldo, cancelado) {
    return {
      linha: ++linhaSeq, chave: _chaveLoteFioCru(tipoFio, nf), tipoFio: tipoFio, nf: nf, data: data,
      quantidade: quantidade, saldo: saldo, cancelado: !!cancelado
    };
  }
  function achar(r, tipo) { return r.filter(function (t) { return t.tipoFio === tipo; })[0] || { nfs: [] }; }

  var r = _nfsZeradasPorTipo([
    lote('Fio B', 20, new Date(2026, 1, 25), 3012.35, -48.2),    // negativa: entra
    lote('Fio B', '10', new Date(2026, 0, 27), 3006.51, 0),      // zerada: entra (e vem antes: data mais antiga)
    lote('Fio B', '30', new Date(2026, 2, 25), 4010.36, 1200.5), // ainda tem saldo: fora — e é a mais nova do tipo
    lote('Fio B', '40', new Date(2026, 5, 26), 4001.23, 0, true), // cancelada: fora (e não conta como "mais nova")
    lote('Fio A', '5', new Date(2025, 11, 30), 1000, 4e-13),     // resíduo de ponto flutuante: entra, saldo 0
    lote('Fio C', '1', new Date(2026, 0, 10), 100, 0),           // dois lotes zerados do mesmo tipo:
    lote('Fio C', '2', new Date(2026, 2, 10), 100, 0),           //   só o mais novo é a "última"
    lote('Fio Reflexx Pet', '60', new Date(2026, 0, 5), 100, 0), // tipo casa por "contém": uma NF mais nova
    lote('Fio Reflexx', '61', new Date(2026, 2, 5), 100, 0)      //   de "Fio Reflexx" tira a "última" da de "Pet"
  ]);
  var b = achar(r, 'Fio B').nfs, a = achar(r, 'Fio A').nfs, c = achar(r, 'Fio C').nfs;
  check('tipos em ordem alfabética', r.map(function (t) { return t.tipoFio; }).join('|') === 'Fio A|Fio B|Fio C|Fio Reflexx|Fio Reflexx Pet', JSON.stringify(r));
  check('só zerada/negativa entra (cancelada e com saldo ficam fora)', b.length === 2, JSON.stringify(b));
  check('NFs pela data da NF, mais antiga primeiro', b.length === 2 && b[0].nf === '10' && b[1].nf === '20', JSON.stringify(b));
  check('saldo negativo preservado', b.length === 2 && b[1].saldo === -48.2 && b[1].saldoInicial === 3012.35, JSON.stringify(b[1]));
  check('NF vira texto e data vem em dd/MM/aaaa', b.length === 2 && b[1].nf === '20' && b[1].data === '25/02/2026', JSON.stringify(b[1]));
  check('resíduo de ponto flutuante vira saldo 0', a.length === 1 && a[0].saldo === 0, JSON.stringify(a));
  check('cada NF traz a linha da planilha', b.length === 2 && b[0].linha === 3 && b[1].linha === 2, JSON.stringify(b));
  check('NF zerada com uma mais nova ativa no tipo NÃO é a última', b.length === 2 && !b[0].ultima && !b[1].ultima, JSON.stringify(b));
  check('única NF do tipo É a última', a.length === 1 && a[0].ultima === true, JSON.stringify(a));
  check('dois zerados do mesmo tipo: só o mais novo é a última', c.length === 2 && !c[0].ultima && c[1].ultima, JSON.stringify(c));
  check('NF mais nova de tipo parecido ("contém") tira a última da mais antiga',
    achar(r, 'Fio Reflexx Pet').nfs[0].ultima === false && achar(r, 'Fio Reflexx').nfs[0].ultima === true,
    JSON.stringify([achar(r, 'Fio Reflexx Pet'), achar(r, 'Fio Reflexx')]));

  Logger.log(relatorio.ok ? '=== TESTE PASSOU ===' : '=== TESTE FALHOU — confira os itens "FALHOU" acima ===');
  return relatorio;
}

/**
 * Teste PURO da regra "a linha escolhida na Confirmar Embarque recebe o
 * desconto primeiro" (`_planejarDescontoPendencia`) e do alvo da baixa de crú
 * (`_alvoBaixaConfirmacao`), além do quadro vermelho de avisos do PDF
 * (`_confirmacaoEmbarqueHTML`). Não lê nem grava planilha (usa linhas e
 * quantidades inventadas), então pode rodar à vontade. Executar pelo editor:
 * escolher `testarBaixaPendenciaPorLinha` → Executar → ver o "Log de execução".
 */
function testarBaixaPendenciaPorLinha() {
  var relatorio = { ok: true, checks: [] };
  function check(nome, condicao, detalhe) {
    Logger.log((condicao ? 'OK   ' : 'FALHOU ') + nome + (!condicao && detalhe ? ' — veio ' + detalhe : ''));
    relatorio.checks.push({ nome: nome, ok: !!condicao, detalhe: detalhe || '' });
    if (!condicao) relatorio.ok = false;
  }
  function pedido(row, item, id, sugerido, dataLimite) {
    return { __row: row, ITEM: item, ID_LINHA: id, SUGERIDO: sugerido, DATA_LIMITE: dataLimite };
  }
  function plano(regs, itens) { return _planejarDescontoPendencia(regs, itens); }
  function j(o) { return JSON.stringify(o); }

  // --- alvo da baixa de crú -------------------------------------------------
  check('alvo: baseline à frente do razão (sobra do pedido anterior) não cobra a mais — 0 baixado, baseline 20, confirma 580 → 580 (antes: 600)',
    _alvoBaixaConfirmacao(0, 20, 580) === 580, _alvoBaixaConfirmacao(0, 20, 580));
  check('alvo: razão = baseline (parcial normal) → baseline + kg',
    _alvoBaixaConfirmacao(50, 50, 102) === 152, _alvoBaixaConfirmacao(50, 50, 102));
  check('alvo: razão acima do baseline (tingido já lançado) → baseline + kg, como sempre',
    _alvoBaixaConfirmacao(80, 50, 30) === 80, _alvoBaixaConfirmacao(80, 50, 30));
  check('alvo: parte "do estoque" adiantou o baseline (40) sem baixa → o resto (60) baixa 60, não 100',
    _alvoBaixaConfirmacao(0, 40, 60) === 60, _alvoBaixaConfirmacao(0, 40, 60));

  // --- desconto na pendência ------------------------------------------------
  var h1 = pedido(2, '4414', 'h1', 30, new Date(2026, 9, 1));   // prazo antes
  var h2 = pedido(3, '4414', 'h2', 80, new Date(2026, 10, 1));  // prazo depois
  var p = plano([h1, h2], [{ item: '4414', quantidade: 80, idLinha: 'h2' }]);
  check('confirma o pedido de prazo MAIOR: só ele é descontado (o de prazo menor continua aberto)',
    p.descontoPorLinha[3] === 80 && !p.descontoPorLinha[2], j(p));

  p = plano([h1, h2], [{ item: '4414', quantidade: 50, idLinha: 'h1' }]);
  check('kg acima do pedido escolhido: ele zera (30) e a sobra (20) cai no outro pedido do código',
    p.descontoPorLinha[2] === 30 && p.descontoPorLinha[3] === 20, j(p));

  p = plano([h1, h2], [{ item: '4414', quantidade: 50 }]);
  check('sem idLinha (PDF importado): FIFO por prazo, como sempre (30 no 1º, 20 no 2º)',
    p.descontoPorLinha[2] === 30 && p.descontoPorLinha[3] === 20, j(p));

  p = plano([h1, h2], [{ item: '4414', quantidade: 50, idLinha: 'nao-existe' }]);
  check('idLinha que não existe mais (alguém já fechou a linha): cai no FIFO por prazo, sem perder kg',
    p.descontoPorLinha[2] === 30 && p.descontoPorLinha[3] === 20, j(p));

  p = plano([h1, h2], [{ item: '4414', quantidade: 30, idLinha: 'h1' }, { item: '4414', quantidade: 80, idLinha: 'h2' }]);
  check('mesmo código, duas linhas no mesmo embarque: cada uma desconta a sua (30 e 80)',
    p.descontoPorLinha[2] === 30 && p.descontoPorLinha[3] === 80 && !p.semLinha['4414'], j(p));

  p = plano([h1, h2], [{ item: '4414', quantidade: 150, idLinha: 'h2' }]);
  check('kg acima de TODAS as linhas: o excedente fica registrado em `semLinha`',
    p.descontoPorLinha[3] === 80 && p.descontoPorLinha[2] === 30 && p.semLinha['4414'] === 40, j(p));

  p = plano([h1, h2], [{ item: '9999', quantidade: 10 }]);
  check('item sem linha nenhuma: nada é descontado e o kg fica em `semLinha`',
    !p.descontoPorLinha[2] && !p.descontoPorLinha[3] && p.semLinha['9999'] === 10, j(p));

  var p1 = pedido(2, '5233', 'p1', 180, new Date(2026, 8, 22));
  var p2 = pedido(3, '5233', 'p2', 600, new Date(2026, 8, 23));
  p = plano([p1, p2], [{ item: '5233', quantidade: 200, idLinha: 'p1' }]);
  check('caso do embarque 1000: 200 kg no pedido de 180 → 180 nele e 20 no seguinte',
    p.descontoPorLinha[2] === 180 && p.descontoPorLinha[3] === 20, j(p));

  p = plano([h1, pedido(3, '4414', 'sem-sugerido', 0, new Date(2026, 9, 2))], [{ item: '4414', quantidade: 10, idLinha: 'sem-sugerido' }]);
  check('linha escolhida sem SUGERIDO (0): não recebe desconto; o kg vai pra outra linha do código',
    !p.descontoPorLinha[3] && p.descontoPorLinha[2] === 10, j(p));

  // --- quadro vermelho do PDF ---------------------------------------------------
  var resumo = [{
    tipoFio: 'Fio Poliester', totalTingido: 30, totalEstoque: 0, maoObra: 0,
    itens: [{ item: 'X<b>1', quantidade: 30, qtdEstoque: 0, obs: '', volumes: 1 }], lotes: []
  }];
  var html = _confirmacaoEmbarqueHTML(1, '30/09/2026', resumo, 0, 'CEARÁ', '', { ativo: false },
    [{ item: 'X<b>1', tipo: 'diferenca', mensagem: 'consumo 600 ≠ tingido 580 <script>' }]);
  check('PDF com avisos: quadro vermelho "conferir o fio crú"', html.indexOf('Atenção — conferir o fio crú') !== -1);
  check('PDF com avisos: texto do aviso escapado (sem HTML cru)', html.indexOf('<script>') === -1 && html.indexOf('&lt;script&gt;') !== -1);
  var htmlSem = _confirmacaoEmbarqueHTML(1, '30/09/2026', resumo, 0, 'CEARÁ', '', { ativo: false });
  check('PDF sem avisos (chamada antiga, 7 argumentos): nada de quadro vermelho', htmlSem.indexOf('conferir o fio crú') === -1);

  Logger.log(relatorio.ok ? '=== TESTE PASSOU ===' : '=== TESTE FALHOU — confira os itens "FALHOU" acima ===');
  return relatorio;
}
