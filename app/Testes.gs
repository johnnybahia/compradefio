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
