// ==============================
// Code.gs
// ==============================

/**
 * Atualiza o menu principal e adiciona um menu separado para processar cores.
 */
function updateMenus() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("GESTÃO DO ESTOQUE")
    .addItem("Inserir Estoque", "showEstoqueSidebar")
    .addItem("Inserir Grupo", "showGrupoDialog")
    .addSeparator()
    .addItem("Localizar Produto", "localizarProduto")
    .addItem("Mostrar Todos", "mostrarTodos")
    .addSeparator()
    .addItem("Gerar Relatório", "abrirDialogRelatorioEstoque")
    .addItem("Relatório por Grupo", "abrirDialogRelatorioPorGrupo")
    .addItem("Listagem de Estoque", "showListagemEstoqueSidebar")
    .addItem("Atualizar Compra de Fio e Histórico", "atualizarCompraDeFioEHistorico")
    .addSeparator()
    .addItem("Atualizar Total Embarcado", "atualizarTotalEmbarcado")
    .addItem("Alternar Restauração", "toggleRestore")
    .addItem("Corrigir Datas em Texto", "corrigirDatasEmTexto")
    .addItem("Apagar Última Linha", "apagarUltimaLinha")
    .addSeparator()
    .addItem("ÚLTIMA LINHA", "select10RowsBelow")
    .addSeparator()
    .addItem("Estoque por Período", "abrirDialogEstoquePorPeriodo")
    .addItem("Limpar Filtro", "limparFiltroEstoque")
    .addSeparator()
    .addItem("Estoque 3 Meses", "showEstoque3MesesSidebar")
    .addSeparator()
    .addItem("Cores Desatualizadas", "showCoresDesatualizadasDialog")
    .addToUi();
}

/**
 * onOpen: Executada quando a planilha é aberta.
 */

/* ... (demais funções já existentes no seu script, como backupEstoqueData, showEstoqueSidebar, etc.) ... */


/* ================================
   NOVAS FUNÇÕES: Processamento de Cores Desatualizadas via Sidebar
   ================================ */

/**
 * showCoresSidebar: Abre a sidebar que lista os valores (cores) da coluna E da aba "CORES DESATUALIZADAS".
 */
function showCoresSidebar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetCores = ss.getSheetByName("CORES DESATUALIZADAS");
  if (!sheetCores) {
    SpreadsheetApp.getUi().alert("A aba 'CORES DESATUALIZADAS' não foi encontrada.");
    return;
  }
  
  // Considera que os dados da coluna E começam na linha 2 (com cabeçalho na linha 1)
  var lastRow = sheetCores.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert("Não há dados na coluna E da aba CORES DESATUALIZADAS.");
    return;
  }
  var coresData = sheetCores.getRange(2, 5, lastRow - 1, 1).getValues();
  var cores = [];
  for (var i = 0; i < coresData.length; i++) {
    var val = coresData[i][0];
    if (val && cores.indexOf(val) === -1) {
      cores.push(val);
    }
  }
  
  var template = HtmlService.createTemplateFromFile("SidebarCores");
  template.cores = JSON.stringify(cores);
  var html = template.evaluate().setTitle("Cores Desatualizadas");
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * processCoresFromSidebar: Para cada item (cor) selecionado na sidebar,
 * procura na aba "ESPELHO DO ESTOQUE" os registros cujo valor da coluna A seja igual (case-insensitive)
 * e pega os 5 últimos registros. Em seguida, escreve na aba "CORES DESATUALIZADAS" nas colunas:
 *   - A: Item (coluna A do ESPELHO)
 *   - B: Valor da coluna B do ESPELHO
 *   - C: Data (coluna C do ESPELHO)
 *   - D: Valor da coluna E do ESPELHO
 */
function processCoresFromSidebar(selectedCores) {
  if (!selectedCores || selectedCores.length === 0) {
    return "Nenhuma cor foi selecionada.";
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEspelho = ss.getSheetByName("ESPELHO DO ESTOQUE");
  if (!sheetEspelho) {
    throw new Error("A aba 'ESPELHO DO ESTOQUE' não foi encontrada.");
  }
  
  // Lê todos os registros da aba ESPELHO DO ESTOQUE (supondo cabeçalho na linha 1)
  var lastRowEspelho = sheetEspelho.getLastRow();
  if (lastRowEspelho < 2) {
    throw new Error("Não há dados na aba 'ESPELHO DO ESTOQUE'.");
  }
  var espelhoData = sheetEspelho.getRange(2, 1, lastRowEspelho - 1, sheetEspelho.getLastColumn()).getValues();
  
  var resultados = [];
  
  // Para cada item selecionado, filtra os registros cujo valor da coluna A (índice 0) seja igual (case-insensitive)
  selectedCores.forEach(function(item) {
    var filtrados = espelhoData.filter(function(row) {
      return row[0] && row[0].toString().toLowerCase() === item.toString().toLowerCase();
    });
    // Pega os 5 últimos registros
    var ultimos5 = filtrados.slice(-5);
    ultimos5.forEach(function(row) {
      // Mapeia: Coluna A: item (índice 0), Coluna B: valor (índice 1), Coluna C: data (índice 2), Coluna D: valor da coluna E (índice 4)
      resultados.push([row[0], row[1], row[2], row[4]]);
    });
  });
  
  // Escreve os resultados na aba "CORES DESATUALIZADAS" sobrescrevendo as colunas A:D
  var sheetCores = ss.getSheetByName("CORES DESATUALIZADAS");
  if (!sheetCores) {
    sheetCores = ss.insertSheet("CORES DESATUALIZADAS");
  }
  // Limpa as colunas A a D
  sheetCores.getRange("A:D").clearContent();
  // Cabeçalho opcional
  sheetCores.getRange("A1:D1").setValues([["Item", "Valor B", "Data", "Valor E"]]);
  if (resultados.length > 0) {
    sheetCores.getRange(2, 1, resultados.length, 4).setValues(resultados);
  }
  
  return "Processamento concluído. Foram encontrados " + resultados.length + " registros.";
}

/* ================================
   Fim das Novas Funções
   ================================ */


/**
 * onOpen: Executada quando a planilha é aberta.
 * Cria o menu, remove filtros na aba "ESTOQUE" e faz backup dos dados.
 */
function onOpen() {
  updateMenus();
  backupEstoqueData();
  removeFilterOnOpen();
  Logger.log("onOpen: Menu criado, backup realizado e filtro da aba ESTOQUE removido.");
}

/**
 * removeFilterOnOpen: Remove o filtro ativo na aba "ESTOQUE", se existir.
 */
function removeFilterOnOpen() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEstoque = ss.getSheetByName("ESTOQUE");
  if (sheetEstoque && sheetEstoque.getFilter()) {
    sheetEstoque.getFilter().remove();
    Logger.log("removeFilterOnOpen: Filtro removido na aba ESTOQUE.");
  }
}

/**
 * backupEstoqueData: Copia as últimas 500 linhas da aba "ESTOQUE" para a aba "BACKUP_ESTOQUE".
 */
function backupEstoqueData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEstoque = ss.getSheetByName("ESTOQUE");
  if (!sheetEstoque) return;
  
  var lastRow = sheetEstoque.getLastRow();
  var startRow = Math.max(1, lastRow - 500 + 1);
  var numRows = lastRow - startRow + 1;
  var lastColumn = sheetEstoque.getLastColumn();
  var values = sheetEstoque.getRange(startRow, 1, numRows, lastColumn).getValues();
  
  var sheetBackup = ss.getSheetByName("BACKUP_ESTOQUE");
  if (!sheetBackup) {
    sheetBackup = ss.insertSheet("BACKUP_ESTOQUE");
  }
  if (sheetBackup.getMaxRows() < lastRow) {
    sheetBackup.insertRowsAfter(sheetBackup.getMaxRows(), lastRow - sheetBackup.getMaxRows());
  }
  sheetBackup.getRange(startRow, 1, numRows, lastColumn).clearContent();
  sheetBackup.getRange(startRow, 1, numRows, lastColumn).setValues(values);
  sheetBackup.hideSheet();
  Logger.log("backupEstoqueData: Backup das linhas de " + startRow + " até " + lastRow + " realizado.");
}

/**
 * onEdit: Se a edição ocorrer na aba EMBARQUES (colunas A, B ou E), chama atualizarTotalEmbarcado;
 * se ocorrer na aba ESTOQUE, impede edições manuais.
 */
function onEdit(e) {
  var sheet = e.range.getSheet();
  var sheetName = sheet.getName();
  
  if (sheetName === "EMBARQUES") {
    var col = e.range.getColumn();
    if (col === 1 || col === 2 || col === 5) {
      atualizarTotalEmbarcado();
    }
    return;
  }
  
  if (sheetName !== "ESTOQUE") return;
  
  var restoreEnabled = PropertiesService.getScriptProperties().getProperty("restoreEnabled");
  if (restoreEnabled === "false") {
    // Edição/colagem manual liberada: converte datas coladas como texto em datas reais.
    normalizarDatasColadas(e.range);
    Logger.log("onEdit: Restauração desativada, datas da faixa colada normalizadas.");
    return;
  }
  
  if (PropertiesService.getScriptProperties().getProperty("editingViaScript") === "true") {
    return;
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetBackup = ss.getSheetByName("BACKUP_ESTOQUE");
  if (!sheetBackup) {
    Logger.log("onEdit: Aba BACKUP_ESTOQUE não encontrada.");
    return;
  }
  
  var editedRange = e.range;
  var numRows = editedRange.getNumRows();
  var numCols = editedRange.getNumColumns();
  var startRow = editedRange.getRow();
  var startCol = editedRange.getColumn();
  
  var backupValues = sheetBackup.getRange(startRow, startCol, numRows, numCols).getValues();
  var newValues = [];
  for (var r = 0; r < numRows; r++) {
    var row = [];
    for (var c = 0; c < numCols; c++) {
      row.push(backupValues[r][c] !== "" ? backupValues[r][c] : "");
    }
    newValues.push(row);
  }
  
  PropertiesService.getScriptProperties().setProperty("editingViaScript", "true");
  editedRange.setValues(newValues);
  PropertiesService.getScriptProperties().deleteProperty("editingViaScript");
  
  SpreadsheetApp.getUi().alert("Edição manual não é permitida. Utilize o sidebar para inserir dados.");
  Logger.log("onEdit: Edição manual detectada e revertida na faixa " + editedRange.getA1Notation());
}

/**
 * toggleRestore: Alterna a restauração de dados para permitir edições manuais temporariamente.
 */
function toggleRestore() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt("Digite a senha para alternar a restauração dos dados:");
  if (response.getSelectedButton() !== ui.Button.OK) return;
  var senha = response.getResponseText();
  if (senha !== "919633") {
    ui.alert("Senha incorreta!");
    return;
  }
  var restoreEnabled = PropertiesService.getScriptProperties().getProperty("restoreEnabled");
  if (restoreEnabled === null || restoreEnabled === "true") {
    PropertiesService.getScriptProperties().setProperty("restoreEnabled", "false");
    ui.alert("Restauração desativada. Agora você poderá editar manualmente.");
  } else {
    PropertiesService.getScriptProperties().setProperty("restoreEnabled", "true");
    ui.alert("Restauração ativada. As edições manuais serão revertidas automaticamente.");
  }
  updateMenus();
}

/**
 * apagarUltimaLinha: Apaga a última linha preenchida da aba ESTOQUE.
 */
function apagarUltimaLinha() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEstoque = ss.getSheetByName("ESTOQUE");
  if (!sheetEstoque) {
    SpreadsheetApp.getUi().alert("A aba ESTOQUE não foi encontrada.");
    return;
  }
  var lastRow = sheetEstoque.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert("Não há dados para apagar.");
    return;
  }
  PropertiesService.getScriptProperties().setProperty("editingViaScript", "true");
  sheetEstoque.deleteRow(lastRow);
  PropertiesService.getScriptProperties().deleteProperty("editingViaScript");
  backupEstoqueData();
  SpreadsheetApp.getUi().alert("Última linha apagada com sucesso.");
}

/**
 * showGrupoDialog: Abre o diálogo para inserir um novo grupo na aba DADOS.
 */
function showGrupoDialog() {
  var template = HtmlService.createTemplateFromFile("DialogInserirGrupo");
  template.groupList = JSON.stringify(getGroupList());
  var htmlOutput = template.evaluate().setWidth(400).setHeight(250);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, "INSERIR GRUPO");
}

/**
 * inserirGrupo: Insere o grupo na aba DADOS.
 */
function inserirGrupo(formData) {
  var group = formData.group;
  if (!group || group.trim() === "") {
    throw new Error("⚠️ Informe um grupo.");
  }
  group = group.trim();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetDados = ss.getSheetByName("DADOS");
  if (!sheetDados) throw new Error("A aba DADOS não foi encontrada.");
  var existingGroups = getGroupList();
  if (existingGroups.indexOf(group) !== -1) {
    SpreadsheetApp.getUi().alert("Grupo já cadastrado.");
    return "Grupo já cadastrado.";
  }
  var lastRow = sheetDados.getLastRow();
  var newRow = lastRow < 2 ? 2 : lastRow + 1;
  sheetDados.getRange(newRow, 4).setValue(group);
  SpreadsheetApp.getUi().alert("Grupo inserido com sucesso.");
  return "Grupo inserido com sucesso!";
}

/**
 * atualizarTotalEmbarcado: Atualiza a aba TOTAL EMBARCADO com os cadastros exclusivos e seus totais.
 * Os cadastros são gravados como texto para evitar formatação como data.
 * Se na coluna E de EMBARQUES houver "CHEGOU", subtrai o valor (sem deixar negativo).
 * Cria filtro na faixa A:B. (Mensagem de alerta removida)
 */
function atualizarTotalEmbarcado() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEmbarques = ss.getSheetByName("EMBARQUES");
  if (!sheetEmbarques) throw new Error("A aba EMBARQUES não foi encontrada.");
  
  var lastRow = sheetEmbarques.getLastRow();
  if (lastRow < 2) {
    return "Sem dados na aba EMBARQUES.";
  }
  
  var dataRange = sheetEmbarques.getRange(2, 1, lastRow - 1, sheetEmbarques.getLastColumn());
  var dataValues = dataRange.getValues();
  
  var totais = {};
  dataValues.forEach(function(row) {
    var cadastro = row[0] ? row[0].toString().trim() : "";
    if (cadastro === "") return;
    var valor = parseFloat(row[1]) || 0;
    var status = row[4] ? row[4].toString().trim().toLowerCase() : "";
    if (!totais.hasOwnProperty(cadastro)) {
      totais[cadastro] = 0;
    }
    if (status === "chegou") {
      totais[cadastro] = Math.max(totais[cadastro] - valor, 0);
    } else {
      totais[cadastro] += valor;
    }
  });
  
  var sheetTotal = ss.getSheetByName("TOTAL EMBARCADO");
  if (!sheetTotal) {
    sheetTotal = ss.insertSheet("TOTAL EMBARCADO");
  }
  sheetTotal.clearContents();
  sheetTotal.getRange(1, 1, 1, 2).setValues([["CADASTRO", "TOTAL"]]);
  
  var output = [];
  for (var cadastro in totais) {
    if (totais.hasOwnProperty(cadastro)) {
      output.push(["'" + cadastro, totais[cadastro]]);
    }
  }
  
  if (output.length > 0) {
    sheetTotal.getRange(2, 1, output.length, 2).setValues(output);
    sheetTotal.getRange(2, 1, output.length, 1).setNumberFormat("@");
  }
  
  if (sheetTotal.getFilter()) {
    sheetTotal.getFilter().remove();
  }
  sheetTotal.getRange(1, 1, sheetTotal.getLastRow(), 2).createFilter();
  
  return "Total embarcado atualizado com sucesso!";
}

/**
 * atualizarCompraDeFio: Atualiza a aba COMPRA DE FIO com os valores das abas RELATORIO e TOTAL EMBARCADO.
 * Compara o Total Compra com o threshold definido em J1 para definir "URGENTE" ou "ESTOQUE".
 */
function atualizarCompraDeFio() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  var sheetCompra = ss.getSheetByName("COMPRA DE FIO");
  if (!sheetCompra) {
    throw new Error("A aba COMPRA DE FIO não foi encontrada.");
  }
  var compraData = sheetCompra.getDataRange().getValues();
  if (compraData.length < 2) {
    SpreadsheetApp.getUi().alert("Não há cadastros na aba COMPRA DE FIO para atualizar.");
    return;
  }
  var cadastrosCompra = compraData.slice(1).map(function(row) {
    return row[0] ? row[0].toString().replace(/^'/, "").trim() : "";
  });
  
  var sheetRelatorio = ss.getSheetByName("RELATORIO");
  if (!sheetRelatorio) {
    throw new Error("A aba RELATORIO não foi encontrada.");
  }
  var relData = sheetRelatorio.getDataRange().getValues();
  relData.shift();
  var relMap = {};
  relData.forEach(function(row) {
    var cad = row[0] ? row[0].toString().trim() : "";
    var valor = parseFloat(row[1]) || 0;
    if (cad) {
      relMap[cad] = valor;
    }
  });
  
  var sheetTotal = ss.getSheetByName("TOTAL EMBARCADO");
  if (!sheetTotal) {
    throw new Error("A aba TOTAL EMBARCADO não foi encontrada.");
  }
  var totalData = sheetTotal.getDataRange().getValues();
  totalData.shift();
  var totalMap = {};
  totalData.forEach(function(row) {
    var cad = row[0] ? row[0].toString().replace(/^'/, "").trim() : "";
    var valor = parseFloat(row[1]) || 0;
    if (cad) {
      totalMap[cad] = valor;
    }
  });
  
  var notFound = [];
  var totalCompra = [];
  var breakdownRel = [];
  var breakdownTot = [];
  
  cadastrosCompra.forEach(function(cad) {
    if (!cad) return;
    var valorRel = relMap.hasOwnProperty(cad) ? relMap[cad] : 0;
    var valorTotal = totalMap.hasOwnProperty(cad) ? totalMap[cad] : 0;
    var soma = valorRel + valorTotal;
    if (!relMap.hasOwnProperty(cad)) {
      notFound.push(cad);
    }
    totalCompra.push([soma]);
    breakdownRel.push([valorRel]);
    breakdownTot.push([valorTotal]);
  });
  
  var lastRowCompra = sheetCompra.getLastRow();
  if (lastRowCompra >= 2) {
    sheetCompra.getRange(2, 2, lastRowCompra - 1, 1).clearContent();
    sheetCompra.getRange(2, 5, lastRowCompra - 1, 1).clearContent();
    sheetCompra.getRange(2, 6, lastRowCompra - 1, 2).clearContent();
  }
  
  var threshold = parseFloat(sheetCompra.getRange("J1").getValue());
  if (isNaN(threshold)) {
    threshold = 0;
  }
  
  if (totalCompra.length > 0) {
    var colTotal = [];
    var colsStatusRelTot = [];
    for (var i = 0; i < totalCompra.length; i++) {
      var totalValue = totalCompra[i][0];
      var label = parseFloat(totalValue) < threshold ? "URGENTE" : "ESTOQUE";
      colTotal.push([totalValue]);
      colsStatusRelTot.push([label, breakdownRel[i][0], breakdownTot[i][0]]);
    }
    // Escrita em lote (2 chamadas) no lugar de 4 setValue por linha.
    sheetCompra.getRange(2, 2, colTotal.length, 1).setValues(colTotal);
    sheetCompra.getRange(2, 5, colsStatusRelTot.length, 3).setValues(colsStatusRelTot);
  }
  
  var existingFilter = sheetCompra.getFilter();
  if (existingFilter) {
    existingFilter.remove();
  }
  sheetCompra.getRange(1, 1, sheetCompra.getLastRow(), 7).createFilter();
  
  if (notFound.length > 0) {
    SpreadsheetApp.getUi().alert("Os seguintes cadastros não foram encontrados no RELATORIO: " + notFound.join(", "));
  } else {
    SpreadsheetApp.getUi().alert("Compra de fio atualizada com sucesso!");
  }
  
  return "Compra de fio atualizada com sucesso!";
}

/**
 * copyCompraToHistorico: Copia os dados da aba COMPRA DE FIO para a aba HISTORICO, adicionando a data/hora atual.
 */
function copyCompraToHistorico() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetCompra = ss.getSheetByName("COMPRA DE FIO");
  var historicoSheet = ss.getSheetByName("HISTORICO");
  if (!historicoSheet) {
    historicoSheet = ss.insertSheet("HISTORICO");
  }
  
  var numRowsToCopy = sheetCompra.getLastRow() - 1;
  Logger.log("Número de linhas para copiar: " + numRowsToCopy);
  if (numRowsToCopy > 0) {
    var compData = sheetCompra.getRange(2, 1, numRowsToCopy, 7).getValues();
    var now = new Date();
    var historicoData = compData.map(function(row) {
      return row.concat([now]);
    });
    var lastRowHistorico = historicoSheet.getLastRow();
    var startRowHistorico = lastRowHistorico < 1 ? 1 : lastRowHistorico + 1;
    historicoSheet.getRange(startRowHistorico, 1, historicoData.length, historicoData[0].length).setValues(historicoData);
    Logger.log("Dados copiados para HISTORICO a partir da linha " + startRowHistorico);
  } else {
    Logger.log("Não há linhas para copiar na aba COMPRA DE FIO.");
  }
}

/**
 * atualizarCompraDeFioEHistorico: Executa atualizarCompraDeFio() e, em seguida, copyCompraToHistorico().
 */
function atualizarCompraDeFioEHistorico() {
  atualizarCompraDeFio();
  copyCompraToHistorico();
}

/**
 * showEstoqueSidebar: Abre o formulário de cadastro de estoque na sidebar.
 */
function showEstoqueSidebar() {
  var nextRow = updateUnprotectedRange();
  Logger.log("showEstoqueSidebar: Próxima linha para cadastro: " + nextRow);
  
  var template = HtmlService.createTemplateFromFile("DialogEstoque");
  template.itemList = JSON.stringify(getItemList());
  template.groupList = JSON.stringify(getGroupList());
  template.nfList = JSON.stringify(getNfList());
  template.obsList = JSON.stringify(getObsList());
  template.currentRow = nextRow;
  
  var htmlOutput = template.evaluate().setTitle("CADASTRO DE ESTOQUE");
  SpreadsheetApp.getUi().showSidebar(htmlOutput);
}

/**
 * updateUnprotectedRange: Retorna a próxima linha livre na aba ESTOQUE.
 */
function updateUnprotectedRange() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  var nextRow = sheet.getLastRow() + 1;
  return nextRow;
}

/**
 * setActiveNextEmptyCell: Seleciona a célula da coluna A que está 15 linhas abaixo da última preenchida.
 */
function setActiveNextEmptyCell() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (sheet) {
    var nextRow = sheet.getLastRow() + 15;
    sheet.activate();
    sheet.setActiveSelection("A" + nextRow);
    Logger.log("setActiveNextEmptyCell: Célula A" + nextRow + " selecionada.");
  }
}

/**
 * select4RowsBelow: Seleciona a célula da coluna A que está 4 linhas abaixo da última linha preenchida.
 */
function select4RowsBelow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (sheet) {
    var nextRow = sheet.getLastRow() + 4;
    sheet.activate();
    sheet.setActiveSelection("A" + nextRow);
    Logger.log("select4RowsBelow: Célula A" + nextRow + " selecionada.");
  }
}

/**
 * select10RowsBelow: Seleciona a célula da coluna A que está 10 linhas abaixo da última linha preenchida.
 */
function select10RowsBelow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (sheet) {
    var nextRow = sheet.getLastRow() + 10;
    sheet.activate();
    sheet.setActiveSelection("A" + nextRow);
    Logger.log("select10RowsBelow: Célula A" + nextRow + " selecionada.");
  }
}

/**
 * getItemList: Retorna a lista única de itens da aba DADOS (Coluna A).
 */
function getItemList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetDados = ss.getSheetByName("DADOS");
  if (!sheetDados) return [];
  var lastRowDados = sheetDados.getLastRow();
  if (lastRowDados < 1) return [];
  var values = sheetDados.getRange(1, 1, lastRowDados, 1).getValues().flat();
  var items = [];
  for (var i = 0; i < values.length; i++) {
    if (values[i] && values[i].toString().trim() !== "") {
      items.push(values[i].toString().trim());
    }
  }
  return Array.from(new Set(items));
}

/**
 * getGroupList: Retorna a lista única de grupos da aba DADOS (Coluna D).
 */
function getGroupList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetDados = ss.getSheetByName("DADOS");
  if (!sheetDados) return [];
  var lastRowDados = sheetDados.getLastRow();
  if (lastRowDados < 1) return [];
  var values = sheetDados.getRange(1, 4, lastRowDados, 1).getValues().flat();
  var groups = [];
  for (var i = 0; i < values.length; i++) {
    if (values[i] && values[i].toString().trim() !== "") {
      groups.push(values[i].toString().trim());
    }
  }
  return Array.from(new Set(groups));
}

/**
 * getNfList: Retorna a lista única de valores da coluna D da aba ESTOQUE (Nota Fiscal/Pedido).
 */
function getNfList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange("D2:D" + lastRow).getValues().flat();
  var nfList = values.filter(function(v) {
    return v.toString().trim() !== "";
  });
  return Array.from(new Set(nfList));
}

/**
 * getObsList: Retorna a lista única de valores da coluna E da aba ESTOQUE (Cliente/Observações).
 */
function getObsList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange("E2:E" + lastRow).getValues().flat();
  var obsList = values.filter(function(v) {
    return v.toString().trim() !== "";
  });
  return Array.from(new Set(obsList));
}

/**
 * normalize: Função auxiliar para normalizar texto.
 */
function normalize(text) {
  if (!text) return "";
  return text.toString().trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * getLastRegistration: Retorna o último registro de um item na aba "ESPELHO DO ESTOQUE".
 */
function getLastRegistration(item, currentRow) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEspelho = ss.getSheetByName("ESPELHO DO ESTOQUE");
  if (!sheetEspelho) {
    Logger.log("getLastRegistration: Aba ESPELHO DO ESTOQUE não encontrada.");
    return { lastDate: null, lastStock: 0 };
  }
  var lastRowEspelho = sheetEspelho.getLastRow();
  var result = { lastDate: null, lastStock: 0 };
  if (lastRowEspelho < 2) return result;
  // Lê apenas as 3 colunas usadas (A:C) em vez de todas as colunas da aba.
  var data = sheetEspelho.getRange(1, 1, lastRowEspelho, 3).getValues();
  var alvo = normalize(item);
  
  Logger.log("getLastRegistration: Procurando por " + alvo);
  for (var i = data.length - 1; i >= 1; i--) {
    if ((i + 1) >= currentRow) continue;
    var currentItem = data[i][0];
    if (currentItem && normalize(currentItem) === alvo) {
      result.lastDate = data[i][1];
      result.lastStock = data[i][2];
      Logger.log("getLastRegistration: Encontrado na linha " + (i + 1) + " com Data=" + result.lastDate + " e Estoque=" + result.lastStock);
      break;
    }
  }
  return result;
}

/**
 * getLastInfoFromDados: Retorna a última informação não vazia da coluna C da aba DADOS para um produto.
 */
function getLastInfoFromDados(product) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetDados = ss.getSheetByName("DADOS");
  if (!sheetDados) return "";
  var lastRow = sheetDados.getLastRow();
  if (lastRow < 2) return "";
  var data = sheetDados.getRange(2, 1, lastRow - 1, sheetDados.getLastColumn()).getValues();
  var lastInfo = "";
  for (var i = 0; i < data.length; i++) {
    if (data[i][0].toString().trim() === product && data[i][2].toString().trim() !== "") {
      lastInfo = data[i][2];
    }
  }
  return lastInfo;
}

/**
 * showCustomDialog: Exibe um diálogo HTML customizado com uma mensagem.
 */
function showCustomDialog(message) {
  var template = HtmlService.createTemplateFromFile("CustomDialog");
  template.message = message;
  var html = template.evaluate().setWidth(400).setHeight(200);
  SpreadsheetApp.getUi().showModalDialog(html, "AVISO");
}

/**
 * localizarProduto: Abre o diálogo para localizar um produto.
 */
function localizarProduto() {
  var template = HtmlService.createTemplateFromFile("DialogLocalizarProduto");
  template.produtos = JSON.stringify(getProdutosEstoque());
  var htmlOutput = template.evaluate().setWidth(400).setHeight(300);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, "LOCALIZAR PRODUTO");
}

/**
 * filtrarProduto: Aplica um filtro na aba ESTOQUE para exibir apenas as linhas cujo valor da coluna B seja igual ao produto.
 */
function filtrarProduto(produto) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (sheet.getFilter()) {
    sheet.getFilter().remove();
  }
  var range = sheet.getDataRange();
  var filter = range.createFilter();
  var criteria = SpreadsheetApp.newFilterCriteria().whenTextEqualTo(produto).build();
  filter.setColumnFilterCriteria(2, criteria);
}

/**
 * mostrarTodos: Remove o filtro, ordena a aba ESTOQUE pela data (Coluna C) e seleciona uma célula.
 */
function mostrarTodos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (sheet.getFilter()) {
    sheet.getFilter().remove();
  }
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastColumn).sort({ column: 3, ascending: true });
  }
  setActiveNextEmptyCell();
}

/**
 * abrirDialogRelatorioEstoque: Abre o diálogo para definir a faixa de data do relatório.
 */
function abrirDialogRelatorioEstoque() {
  var html = HtmlService.createTemplateFromFile("DialogRelatorioEstoque")
      .evaluate()
      .setWidth(400)
      .setHeight(300);
  SpreadsheetApp.getUi().showModalDialog(html, "RELATÓRIO DE ESTOQUE");
}

/**
 * gerarRelatorioEstoque: Gera o relatório geral para o período definido.
 */
function gerarRelatorioEstoque(dataInicio, dataFim) {
  Logger.log("gerarRelatorioEstoque: Início " + dataInicio + " - Fim " + dataFim);
  var partsInicio = dataInicio.split("/");
  var partsFim = dataFim.split("/");
  var startDate = new Date(partsInicio[2], partsInicio[1] - 1, partsInicio[0], 0, 0, 0);
  var endDate = new Date(partsFim[2], partsFim[1] - 1, partsFim[0], 23, 59, 59);
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEstoque = ss.getSheetByName("ESTOQUE");
  if (!sheetEstoque) throw new Error("A aba ESTOQUE não foi encontrada.");
  
  var lastRow = sheetEstoque.getLastRow();
  if (lastRow < 2) throw new Error("Não há dados na aba ESTOQUE.");
  
  var lastColumn = sheetEstoque.getLastColumn();
  var dataRange = sheetEstoque.getRange(2, 1, lastRow - 1, lastColumn);
  var dataValues = dataRange.getValues();
  
  var filtered = dataValues.filter(function(row) {
    var dt = parseDataCellEstoque(row[2]);
    return dt !== null && dt >= startDate && dt <= endDate;
  });
  
  var grupos = {};
  filtered.forEach(function(row) {
    var prod = row[1];
    if (!grupos[prod]) {
      grupos[prod] = row;
    } else {
      var currentDate = parseDataCellEstoque(row[2]);
      var storedDate = parseDataCellEstoque(grupos[prod][2]);
      if (storedDate === null || (currentDate !== null && currentDate > storedDate)) {
        grupos[prod] = row;
      }
    }
  });
  
  var reportData = [];
  for (var prod in grupos) {
    var row = grupos[prod];
    reportData.push([prod, row[8], row[4], row[2]]);
  }
  
  reportData.sort(function(a, b) {
    var da = parseDataCellEstoque(a[3]);
    var db = parseDataCellEstoque(b[3]);
    return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
  });
  
  var sheetRelatorio = ss.getSheetByName("RELATORIO");
  if (!sheetRelatorio) {
    sheetRelatorio = ss.insertSheet("RELATORIO");
    sheetRelatorio.getRange("J1").setValue(0);
  }
  var threshold = parseFloat(sheetRelatorio.getRange("J1").getValue());
  if (isNaN(threshold)) {
    threshold = 0;
  }
  
  for (var i = 0; i < reportData.length; i++) {
    var novoSaldo = parseFloat(reportData[i][1]);
    if (novoSaldo < threshold) {
      reportData[i].push("URGENTE");
    } else {
      reportData[i].push("ESTOQUE");
    }
  }
  
  sheetRelatorio.clearContents();
  sheetRelatorio.getRange("J1").setValue(threshold);
  sheetRelatorio.getRange(1, 1, 1, 5).setValues([["PRODUTO", "NOVO SALDO", "OBS", "DATA/HORA", "STATUS"]]);
  if (reportData.length > 0) {
    sheetRelatorio.getRange(2, 1, reportData.length, 5).setValues(reportData);
  }
  
  var relFilter = sheetRelatorio.getFilter();
  if (relFilter) {
    relFilter.remove();
  }
  sheetRelatorio.getRange(1, 1, sheetRelatorio.getLastRow(), 5).createFilter();
  
  Logger.log("gerarRelatorioEstoque: Relatório gerado com " + reportData.length + " registros.");
  return "Relatório gerado com sucesso!";
}

/**
 * abrirDialogRelatorioPorGrupo: Abre o diálogo para definir o grupo do relatório.
 */
function abrirDialogRelatorioPorGrupo() {
  var template = HtmlService.createTemplateFromFile("DialogRelatorioPorGrupo");
  template.grupos = JSON.stringify(getGruposEstoque());
  var htmlOutput = template.evaluate().setWidth(400).setHeight(300);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, "RELATÓRIO POR GRUPO");
}

/**
 * getGruposEstoque: Retorna os grupos únicos da aba ESTOQUE (Coluna A).
 */
function getGruposEstoque() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange("A2:A" + lastRow).getValues().flat();
  var grupos = values.filter(function(v) {
    return v.toString().trim() !== "";
  });
  return Array.from(new Set(grupos));
}

/**
 * gerarRelatorioPorGrupo: Gera o relatório para um grupo específico.
 */
function gerarRelatorioPorGrupo(grupoSelecionado) {
  Logger.log("gerarRelatorioPorGrupo: Grupo selecionado: " + grupoSelecionado);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEstoque = ss.getSheetByName("ESTOQUE");
  if (!sheetEstoque) throw new Error("A aba ESTOQUE não foi encontrada.");
  
  var lastRow = sheetEstoque.getLastRow();
  if (lastRow < 2) throw new Error("Não há dados na aba ESTOQUE.");
  
  var lastColumn = sheetEstoque.getLastColumn();
  var dataRange = sheetEstoque.getRange(2, 1, lastRow - 1, lastColumn);
  var dataValues = dataRange.getValues();
  
  var filtered = dataValues.filter(function(row) {
    return row[0].toString().trim() === grupoSelecionado;
  });
  
  var gruposItens = {};
  filtered.forEach(function(row) {
    var item = row[1];
    if (!gruposItens[item]) {
      gruposItens[item] = row;
    } else {
      var currentDate = parseDataCellEstoque(row[2]);
      var storedDate = parseDataCellEstoque(gruposItens[item][2]);
      if (storedDate === null || (currentDate !== null && currentDate > storedDate)) {
        gruposItens[item] = row;
      }
    }
  });
  
  var reportData = [];
  for (var item in gruposItens) {
    var row = gruposItens[item];
    reportData.push([row[0], row[1], row[8], row[2]]);
  }
  
  reportData.sort(function(a, b) {
    var da = parseDataCellEstoque(a[3]);
    var db = parseDataCellEstoque(b[3]);
    return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
  });
  
  var sheetRelatorio = ss.getSheetByName("RELATORIO POR GRUPO DE ITEM");
  if (!sheetRelatorio) {
    sheetRelatorio = ss.insertSheet("RELATORIO POR GRUPO DE ITEM");
  }
  sheetRelatorio.clearContents();
  sheetRelatorio.getRange(1, 1, 1, 4).setValues([["GRUPO", "ITEM", "NOVO SALDO", "DATA/HORA"]]);
  if (reportData.length > 0) {
    sheetRelatorio.getRange(2, 1, reportData.length, 4).setValues(reportData);
  }
  
  Logger.log("gerarRelatorioPorGrupo: Relatório gerado com " + reportData.length + " registros.");
  return "Relatório por grupo gerado com sucesso!";
}

/**
 * processEstoque: Processa os dados do cadastro inserido via formulário.
 */
function processEstoque(formData) {
  Logger.log("processEstoque: Dados inseridos: " + JSON.stringify(formData));
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEstoque = ss.getSheetByName("ESTOQUE");
  var now = new Date();
  var nextRow = sheetEstoque.getLastRow() + 1;
  
  PropertiesService.getScriptProperties().setProperty("editingViaScript", "true");
  
  var lastReg = getLastRegistration(formData.item, nextRow);
  var previousSaldo = lastReg.lastStock || 0;
  var newSaldo = previousSaldo + parseFloat(formData.entrada) - parseFloat(formData.saida);
  var rowData = [
    formData.group,
    formData.item,
    now,
    formData.nf,
    formData.obs,
    previousSaldo,
    formData.entrada,
    formData.saida,
    newSaldo,
    now,
    Session.getActiveUser().getEmail() // MODIFICADO: Captura o usuário ativo automaticamente
  ];
  
  try {
    sheetEstoque.getRange(nextRow, 1, 1, rowData.length).setValues([rowData]);
    Logger.log("processEstoque: Dados inseridos na linha " + nextRow);
  } catch (err) {
    Logger.log("processEstoque: Erro ao inserir dados: " + err);
    showCustomDialog("Erro ao inserir os dados. Por favor, contate o administrador.");
    PropertiesService.getScriptProperties().deleteProperty("editingViaScript");
    return;
  }
  
  PropertiesService.getScriptProperties().deleteProperty("editingViaScript");
  backupEstoqueData();
  
  var lastColumn = sheetEstoque.getLastColumn();
  if (lastReg.lastDate) {
    var lastDate = new Date(lastReg.lastDate);
    var diffDays = (now.getTime() - lastDate.getTime()) / (1000 * 3600 * 24);
    if (diffDays > 20) {
      sheetEstoque.getRange(nextRow, 1, 1, lastColumn).setBackground("red");
      showCustomDialog("⚠️ PRODUTO DESATUALIZADO (ÚLTIMA ATUALIZAÇÃO HÁ MAIS DE 20 DIAS).");
      return;
    }
  }
  // Janela de sucesso removida para agilizar o cadastro.
}

/* ================================
   NOVAS FUNÇÕES: Estoque por Período e Limpar Filtro
   ================================ */

/**
 * abrirDialogEstoquePorPeriodo: Abre um diálogo para que o usuário informe as datas de início e fim.
 */
function abrirDialogEstoquePorPeriodo() {
  var html = HtmlService.createTemplateFromFile("DialogEstoquePorPeriodo")
    .evaluate()
    .setWidth(350)
    .setHeight(250);
  SpreadsheetApp.getUi().showModalDialog(html, "Filtrar Estoque por Período");
}

/**
 * filtrarEstoquePorPeriodo: Copia as linhas da aba ESTOQUE, cuja data na coluna C
 * esteja entre dataInicio e dataFim (formato dd/mm/yyyy), e as cola na aba "FILTRO POR PERIODO".
 * Antes de colar, apaga o conteúdo anterior da aba.
 */
function filtrarEstoquePorPeriodo(dataInicio, dataFim) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEstoque = ss.getSheetByName("ESTOQUE");
  if (!sheetEstoque) throw new Error("A aba ESTOQUE não foi encontrada.");
  
  var lastRow = sheetEstoque.getLastRow();
  if (lastRow < 2) throw new Error("Não há dados na aba ESTOQUE.");
  
  // Divide as datas informadas (formato dd/mm/yyyy) em partes e cria objetos Date.
  var partsInicio = dataInicio.split("/");
  var partsFim = dataFim.split("/");
  if (partsInicio.length !== 3 || partsFim.length !== 3) {
    throw new Error("Formato de data inválido. Use dd/mm/yyyy");
  }
  
  var startDate = new Date(
    parseInt(partsInicio[2], 10), 
    parseInt(partsInicio[1], 10) - 1, 
    parseInt(partsInicio[0], 10)
  );
  
  var endDate = new Date(
    parseInt(partsFim[2], 10), 
    parseInt(partsFim[1], 10) - 1, 
    parseInt(partsFim[0], 10),
    23, 59, 59, 999
  );
  
  // Obtém os dados da aba ESTOQUE (assumindo que a primeira linha é o cabeçalho)
  var dataRange = sheetEstoque.getRange(2, 1, lastRow - 1, sheetEstoque.getLastColumn());
  var dataValues = dataRange.getValues();
  
  // Prepara a aba de destino "FILTRO POR PERIODO"
  var sheetFiltro = ss.getSheetByName("FILTRO POR PERIODO");
  if (!sheetFiltro) {
    sheetFiltro = ss.insertSheet("FILTRO POR PERIODO");
  } else {
    sheetFiltro.clear();
  }
  
  // Copia o cabeçalho da aba ESTOQUE para a aba "FILTRO POR PERIODO"
  var header = sheetEstoque.getRange(1, 1, 1, sheetEstoque.getLastColumn()).getValues();
  sheetFiltro.getRange(1, 1, 1, header[0].length).setValues(header);
  
  var targetData = [];
  
  // Percorre cada linha e copia as que tiverem data na coluna C (índice 2) dentro do período
  for (var i = 0; i < dataValues.length; i++) {
    var row = dataValues[i];
    var dateValue = parseDataCellEstoque(row[2]);
    if (dateValue === null) continue;
    if (dateValue >= startDate && dateValue <= endDate) {
      targetData.push(row);
    }
  }
  
  if (targetData.length > 0) {
    sheetFiltro.getRange(2, 1, targetData.length, targetData[0].length).setValues(targetData);
  }
  
  var targetLastRow = sheetFiltro.getLastRow();
  if (targetLastRow > 1) {
    sheetFiltro.getRange(2, 1, targetLastRow - 1, sheetFiltro.getLastColumn())
              .sort({ column: 3, ascending: true });
  }
  
  return "Dados do período de " + dataInicio + " a " + dataFim + " foram copiados para a aba 'FILTRO POR PERIODO'.";
}

/**
 * limparFiltroEstoque: Remove o filtro da aba ESTOQUE, ordena pela coluna C (datas) de forma ascendente
 * e seleciona a célula 4 linhas abaixo da última linha preenchida.
 */
function limparFiltroEstoque() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (!sheet) throw new Error("A aba ESTOQUE não foi encontrada.");
  
  if (sheet.getFilter()) {
    sheet.getFilter().remove();
  }
  
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).sort({ column: 3, ascending: true });
  }
  
  select4RowsBelow();
  
  return "Filtro removido e planilha ordenada por data.";
}

/**
 * convertDateFormat: Converte uma data do formato dd/mm/yyyy para mm/dd/yyyy.
 */
function convertDateFormat(dateStr) {
  var parts = dateStr.split("/");
  if (parts.length !== 3) throw new Error("Data inválida: " + dateStr);
  return parts[1] + "/" + parts[0] + "/" + parts[2];
}

/* ================================
   NOVAS FUNÇÕES: Estoque 3 Meses
   ================================ */

/**
 * showEstoque3MesesSidebar: Abre um sidebar para que o usuário insira até 10 itens para análise dos últimos 3 meses.
 */
function showEstoque3MesesSidebar() {
  var html = HtmlService.createTemplateFromFile("DialogEstoque3Meses");
  html.itemList = JSON.stringify(getItemList());
  html = html.evaluate().setTitle("Estoque 3 Meses").setWidth(350).setHeight(400);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * processEstoque3Meses: Para cada item inserido via sidebar (até 10),
 * acumula os valores da coluna D da aba "ESPELHO DO ESTOQUE" dos registros
 * dos últimos 3 meses e exibe o total para cada item na aba "CONSUMO 3 MESES".
 *
 * Supõe-se:
 *   - Coluna A: Item
 *   - Coluna B: Data
 *   - Coluna D: Valor
 */
function processEstoque3Meses(formData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Data limite: hoje - 3 meses
  var today = new Date();
  var threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate());
  Logger.log("Hoje: " + today);
  Logger.log("Três meses atrás: " + threeMonthsAgo);
  
  // Obtém os itens do formulário (até 10) e converte para lowercase
  var itemsSelecionados = [];
  for (var i = 1; i <= 10; i++) {
    var value = formData["item" + i];
    if (value && value.trim() !== "") {
      itemsSelecionados.push(value.trim().toLowerCase());
    }
  }
  Logger.log("Itens selecionados: " + itemsSelecionados.join(", "));
  
  // Acessa a aba "ESPELHO DO ESTOQUE"
  // Supõe-se que: Coluna A = Item, Coluna B = Data, Coluna D = Valor
  var sheetEspelho = ss.getSheetByName("ESPELHO DO ESTOQUE");
  if (!sheetEspelho) throw new Error("A aba 'ESPELHO DO ESTOQUE' não foi encontrada.");
  
  var lastRowEspelho = sheetEspelho.getLastRow();
  if (lastRowEspelho < 2) throw new Error("Não há dados na aba 'ESPELHO DO ESTOQUE'.");
  
  var dadosRange = sheetEspelho.getRange(2, 1, lastRowEspelho - 1, sheetEspelho.getLastColumn());
  var dadosValues = dadosRange.getValues();
  Logger.log("Total de registros lidos (Espelho): " + dadosValues.length);
  
  var acumulados = {};
  for (var i = 0; i < itemsSelecionados.length; i++) {
    acumulados[itemsSelecionados[i]] = 0;
  }
  
  for (var j = 0; j < dadosValues.length; j++) {
    var row = dadosValues[j];
    var itemNome = row[0] ? row[0].toString().trim().toLowerCase() : "";
    if (itemsSelecionados.indexOf(itemNome) !== -1) {
      var dataCell = row[1]; // Coluna B
      if (!(dataCell instanceof Date)) {
        dataCell = parseDateBR(dataCell);
      }
      if (dataCell instanceof Date && !isNaN(dataCell) && dataCell >= threeMonthsAgo && dataCell <= today) {
        var valor = parseFloat(row[3]) || 0; // Coluna D é índice 3
        acumulados[itemNome] += valor;
      }
    }
  }
  
  var results = [];
  for (var item in acumulados) {
    if (acumulados.hasOwnProperty(item)) {
      results.push([item, acumulados[item]]);
    }
  }
  
  var sheetConsumo = ss.getSheetByName("CONSUMO 3 MESES");
  if (!sheetConsumo) {
    sheetConsumo = ss.insertSheet("CONSUMO 3 MESES");
  } else {
    sheetConsumo.clear();
  }
  
  sheetConsumo.getRange(1, 1, 1, 2).setValues([["Item", "Total dos Últimos 3 Meses"]]);
  if (results.length > 0) {
    results.sort(function(a, b) {
      return a[0].localeCompare(b[0]);
    });
    sheetConsumo.getRange(2, 1, results.length, 2).setValues(results);
  }
  
  return "Consumo dos últimos 3 meses atualizado na aba 'CONSUMO 3 MESES'.";
}

/* ================================
   NOVAS FUNÇÕES: Cores Desatualizadas
   ================================ */
// ==============================
// Code.gs
// ==============================

/**
 * updateMenus: Cria o menu customizado na interface do Google Sheets.
 * O menu inclui agora as opções "Estoque por Período", "Limpar Filtro", "Estoque 3 Meses" e "Cores Desatualizadas".
 */
function updateMenus() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("GESTÃO DO ESTOQUE")
    .addItem("Inserir Estoque", "showEstoqueSidebar")
    .addItem("Inserir Grupo", "showGrupoDialog")
    .addSeparator()
    .addItem("Localizar Produto", "localizarProduto")
    .addItem("Mostrar Todos", "mostrarTodos")
    .addSeparator()
    .addItem("Gerar Relatório", "abrirDialogRelatorioEstoque")
    .addItem("Relatório por Grupo", "abrirDialogRelatorioPorGrupo")
    .addItem("Listagem de Estoque", "showListagemEstoqueSidebar")
    .addItem("Atualizar Compra de Fio e Histórico", "atualizarCompraDeFioEHistorico")
    .addSeparator()
    .addItem("Atualizar Total Embarcado", "atualizarTotalEmbarcado")
    .addItem("Alternar Restauração", "toggleRestore")
    .addItem("Corrigir Datas em Texto", "corrigirDatasEmTexto")
    .addItem("Apagar Última Linha", "apagarUltimaLinha")
    .addSeparator()
    .addItem("ÚLTIMA LINHA", "select10RowsBelow")
    .addSeparator()
    .addItem("Estoque por Período", "abrirDialogEstoquePorPeriodo")
    .addItem("Limpar Filtro", "limparFiltroEstoque")
    .addSeparator()
    .addItem("Estoque 3 Meses", "showEstoque3MesesSidebar")
    .addSeparator()
    .addItem("Cores Desatualizadas", "showCoresDesatualizadasDialog")
    .addToUi();
}


/**
 * removeFilterOnOpen: Remove o filtro ativo na aba "ESTOQUE", se existir.
 */
function removeFilterOnOpen() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEstoque = ss.getSheetByName("ESTOQUE");
  if (sheetEstoque && sheetEstoque.getFilter()) {
    sheetEstoque.getFilter().remove();
    Logger.log("removeFilterOnOpen: Filtro removido na aba ESTOQUE.");
  }
}

/**
 * backupEstoqueData: Copia as últimas 500 linhas da aba "ESTOQUE" para a aba "BACKUP_ESTOQUE".
 */
function backupEstoqueData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEstoque = ss.getSheetByName("ESTOQUE");
  if (!sheetEstoque) return;
  
  var lastRow = sheetEstoque.getLastRow();
  var startRow = Math.max(1, lastRow - 500 + 1);
  var numRows = lastRow - startRow + 1;
  var lastColumn = sheetEstoque.getLastColumn();
  var values = sheetEstoque.getRange(startRow, 1, numRows, lastColumn).getValues();
  
  var sheetBackup = ss.getSheetByName("BACKUP_ESTOQUE");
  if (!sheetBackup) {
    sheetBackup = ss.insertSheet("BACKUP_ESTOQUE");
  }
  if (sheetBackup.getMaxRows() < lastRow) {
    sheetBackup.insertRowsAfter(sheetBackup.getMaxRows(), lastRow - sheetBackup.getMaxRows());
  }
  sheetBackup.getRange(startRow, 1, numRows, lastColumn).clearContent();
  sheetBackup.getRange(startRow, 1, numRows, lastColumn).setValues(values);
  sheetBackup.hideSheet();
  Logger.log("backupEstoqueData: Backup das linhas de " + startRow + " até " + lastRow + " realizado.");
}

/**
 * onEdit: Se a edição ocorrer na aba EMBARQUES (colunas A, B ou E), chama atualizarTotalEmbarcado;
 * se ocorrer na aba ESTOQUE, impede edições manuais.
 */
function onEdit(e) {
  var sheet = e.range.getSheet();
  var sheetName = sheet.getName();
  
  if (sheetName === "EMBARQUES") {
    var col = e.range.getColumn();
    if (col === 1 || col === 2 || col === 5) {
      atualizarTotalEmbarcado();
    }
    return;
  }
  
  if (sheetName !== "ESTOQUE") return;
  
  var restoreEnabled = PropertiesService.getScriptProperties().getProperty("restoreEnabled");
  if (restoreEnabled === "false") {
    // Edição/colagem manual liberada: converte datas coladas como texto em datas reais.
    normalizarDatasColadas(e.range);
    Logger.log("onEdit: Restauração desativada, datas da faixa colada normalizadas.");
    return;
  }
  
  if (PropertiesService.getScriptProperties().getProperty("editingViaScript") === "true") {
    return;
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetBackup = ss.getSheetByName("BACKUP_ESTOQUE");
  if (!sheetBackup) {
    Logger.log("onEdit: Aba BACKUP_ESTOQUE não encontrada.");
    return;
  }
  
  var editedRange = e.range;
  var numRows = editedRange.getNumRows();
  var numCols = editedRange.getNumColumns();
  var startRow = editedRange.getRow();
  var startCol = editedRange.getColumn();
  
  var backupValues = sheetBackup.getRange(startRow, startCol, numRows, numCols).getValues();
  var newValues = [];
  for (var r = 0; r < numRows; r++) {
    var row = [];
    for (var c = 0; c < numCols; c++) {
      row.push(backupValues[r][c] !== "" ? backupValues[r][c] : "");
    }
    newValues.push(row);
  }
  
  PropertiesService.getScriptProperties().setProperty("editingViaScript", "true");
  editedRange.setValues(newValues);
  PropertiesService.getScriptProperties().deleteProperty("editingViaScript");
  
  SpreadsheetApp.getUi().alert("Edição manual não é permitida. Utilize o sidebar para inserir dados.");
  Logger.log("onEdit: Edição manual detectada e revertida na faixa " + editedRange.getA1Notation());
}

/**
 * toggleRestore: Alterna a restauração de dados para permitir edições manuais temporariamente.
 */
function toggleRestore() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt("Digite a senha para alternar a restauração dos dados:");
  if (response.getSelectedButton() !== ui.Button.OK) return;
  var senha = response.getResponseText();
  if (senha !== "919633") {
    ui.alert("Senha incorreta!");
    return;
  }
  var restoreEnabled = PropertiesService.getScriptProperties().getProperty("restoreEnabled");
  if (restoreEnabled === null || restoreEnabled === "true") {
    PropertiesService.getScriptProperties().setProperty("restoreEnabled", "false");
    ui.alert("Restauração desativada. Agora você poderá editar manualmente.");
  } else {
    PropertiesService.getScriptProperties().setProperty("restoreEnabled", "true");
    ui.alert("Restauração ativada. As edições manuais serão revertidas automaticamente.");
  }
  updateMenus();
}

/**
 * apagarUltimaLinha: Apaga a última linha preenchida da aba ESTOQUE.
 */
function apagarUltimaLinha() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEstoque = ss.getSheetByName("ESTOQUE");
  if (!sheetEstoque) {
    SpreadsheetApp.getUi().alert("A aba ESTOQUE não foi encontrada.");
    return;
  }
  var lastRow = sheetEstoque.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert("Não há dados para apagar.");
    return;
  }
  PropertiesService.getScriptProperties().setProperty("editingViaScript", "true");
  sheetEstoque.deleteRow(lastRow);
  PropertiesService.getScriptProperties().deleteProperty("editingViaScript");
  backupEstoqueData();
  SpreadsheetApp.getUi().alert("Última linha apagada com sucesso.");
}

/**
 * showGrupoDialog: Abre o diálogo para inserir um novo grupo na aba DADOS.
 */
function showGrupoDialog() {
  var template = HtmlService.createTemplateFromFile("DialogInserirGrupo");
  template.groupList = JSON.stringify(getGroupList());
  var htmlOutput = template.evaluate().setWidth(400).setHeight(250);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, "INSERIR GRUPO");
}

/**
 * inserirGrupo: Insere o grupo na aba DADOS.
 */
function inserirGrupo(formData) {
  var group = formData.group;
  if (!group || group.trim() === "") {
    throw new Error("⚠️ Informe um grupo.");
  }
  group = group.trim();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetDados = ss.getSheetByName("DADOS");
  if (!sheetDados) throw new Error("A aba DADOS não foi encontrada.");
  var existingGroups = getGroupList();
  if (existingGroups.indexOf(group) !== -1) {
    SpreadsheetApp.getUi().alert("Grupo já cadastrado.");
    return "Grupo já cadastrado.";
  }
  var lastRow = sheetDados.getLastRow();
  var newRow = lastRow < 2 ? 2 : lastRow + 1;
  sheetDados.getRange(newRow, 4).setValue(group);
  SpreadsheetApp.getUi().alert("Grupo inserido com sucesso.");
  return "Grupo inserido com sucesso!";
}

/**
 * atualizarTotalEmbarcado: Atualiza a aba TOTAL EMBARCADO com os cadastros exclusivos e seus totais.
 * Os cadastros são gravados como texto para evitar formatação como data.
 * Se na coluna E de EMBARQUES houver "CHEGOU", subtrai o valor (sem deixar negativo).
 * Cria filtro na faixa A:B. (Mensagem de alerta removida)
 */
function atualizarTotalEmbarcado() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEmbarques = ss.getSheetByName("EMBARQUES");
  if (!sheetEmbarques) throw new Error("A aba EMBARQUES não foi encontrada.");
  
  var lastRow = sheetEmbarques.getLastRow();
  if (lastRow < 2) {
    return "Sem dados na aba EMBARQUES.";
  }
  
  var dataRange = sheetEmbarques.getRange(2, 1, lastRow - 1, sheetEmbarques.getLastColumn());
  var dataValues = dataRange.getValues();
  
  var totais = {};
  dataValues.forEach(function(row) {
    var cadastro = row[0] ? row[0].toString().trim() : "";
    if (cadastro === "") return;
    var valor = parseFloat(row[1]) || 0;
    var status = row[4] ? row[4].toString().trim().toLowerCase() : "";
    if (!totais.hasOwnProperty(cadastro)) {
      totais[cadastro] = 0;
    }
    if (status === "chegou") {
      totais[cadastro] = Math.max(totais[cadastro] - valor, 0);
    } else {
      totais[cadastro] += valor;
    }
  });
  
  var sheetTotal = ss.getSheetByName("TOTAL EMBARCADO");
  if (!sheetTotal) {
    sheetTotal = ss.insertSheet("TOTAL EMBARCADO");
  }
  sheetTotal.clearContents();
  sheetTotal.getRange(1, 1, 1, 2).setValues([["CADASTRO", "TOTAL"]]);
  
  var output = [];
  for (var cadastro in totais) {
    if (totais.hasOwnProperty(cadastro)) {
      output.push(["'" + cadastro, totais[cadastro]]);
    }
  }
  
  if (output.length > 0) {
    sheetTotal.getRange(2, 1, output.length, 2).setValues(output);
    sheetTotal.getRange(2, 1, output.length, 1).setNumberFormat("@");
  }
  
  if (sheetTotal.getFilter()) {
    sheetTotal.getFilter().remove();
  }
  sheetTotal.getRange(1, 1, sheetTotal.getLastRow(), 2).createFilter();
  
  return "Total embarcado atualizado com sucesso!";
}

/**
 * atualizarCompraDeFio: Atualiza a aba COMPRA DE FIO com os valores das abas RELATORIO e TOTAL EMBARCADO.
 * Compara o Total Compra com o threshold definido em J1 para definir "URGENTE" ou "ESTOQUE".
 */
function atualizarCompraDeFio() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  var sheetCompra = ss.getSheetByName("COMPRA DE FIO");
  if (!sheetCompra) {
    throw new Error("A aba COMPRA DE FIO não foi encontrada.");
  }
  var compraData = sheetCompra.getDataRange().getValues();
  if (compraData.length < 2) {
    SpreadsheetApp.getUi().alert("Não há cadastros na aba COMPRA DE FIO para atualizar.");
    return;
  }
  var cadastrosCompra = compraData.slice(1).map(function(row) {
    return row[0] ? row[0].toString().replace(/^'/, "").trim() : "";
  });
  
  var sheetRelatorio = ss.getSheetByName("RELATORIO");
  if (!sheetRelatorio) {
    throw new Error("A aba RELATORIO não foi encontrada.");
  }
  var relData = sheetRelatorio.getDataRange().getValues();
  relData.shift();
  var relMap = {};
  relData.forEach(function(row) {
    var cad = row[0] ? row[0].toString().trim() : "";
    var valor = parseFloat(row[1]) || 0;
    if (cad) {
      relMap[cad] = valor;
    }
  });
  
  var sheetTotal = ss.getSheetByName("TOTAL EMBARCADO");
  if (!sheetTotal) {
    throw new Error("A aba TOTAL EMBARCADO não foi encontrada.");
  }
  var totalData = sheetTotal.getDataRange().getValues();
  totalData.shift();
  var totalMap = {};
  totalData.forEach(function(row) {
    var cad = row[0] ? row[0].toString().replace(/^'/, "").trim() : "";
    var valor = parseFloat(row[1]) || 0;
    if (cad) {
      totalMap[cad] = valor;
    }
  });
  
  var notFound = [];
  var totalCompra = [];
  var breakdownRel = [];
  var breakdownTot = [];
  
  cadastrosCompra.forEach(function(cad) {
    if (!cad) return;
    var valorRel = relMap.hasOwnProperty(cad) ? relMap[cad] : 0;
    var valorTotal = totalMap.hasOwnProperty(cad) ? totalMap[cad] : 0;
    var soma = valorRel + valorTotal;
    if (!relMap.hasOwnProperty(cad)) {
      notFound.push(cad);
    }
    totalCompra.push([soma]);
    breakdownRel.push([valorRel]);
    breakdownTot.push([valorTotal]);
  });
  
  var lastRowCompra = sheetCompra.getLastRow();
  if (lastRowCompra >= 2) {
    sheetCompra.getRange(2, 2, lastRowCompra - 1, 1).clearContent();
    sheetCompra.getRange(2, 5, lastRowCompra - 1, 1).clearContent();
    sheetCompra.getRange(2, 6, lastRowCompra - 1, 2).clearContent();
  }
  
  var threshold = parseFloat(sheetCompra.getRange("J1").getValue());
  if (isNaN(threshold)) {
    threshold = 0;
  }
  
  if (totalCompra.length > 0) {
    var colTotal = [];
    var colsStatusRelTot = [];
    for (var i = 0; i < totalCompra.length; i++) {
      var totalValue = totalCompra[i][0];
      var label = parseFloat(totalValue) < threshold ? "URGENTE" : "ESTOQUE";
      colTotal.push([totalValue]);
      colsStatusRelTot.push([label, breakdownRel[i][0], breakdownTot[i][0]]);
    }
    // Escrita em lote (2 chamadas) no lugar de 4 setValue por linha.
    sheetCompra.getRange(2, 2, colTotal.length, 1).setValues(colTotal);
    sheetCompra.getRange(2, 5, colsStatusRelTot.length, 3).setValues(colsStatusRelTot);
  }
  
  var existingFilter = sheetCompra.getFilter();
  if (existingFilter) {
    existingFilter.remove();
  }
  sheetCompra.getRange(1, 1, sheetCompra.getLastRow(), 7).createFilter();
  
  if (notFound.length > 0) {
    SpreadsheetApp.getUi().alert("Os seguintes cadastros não foram encontrados no RELATORIO: " + notFound.join(", "));
  } else {
    SpreadsheetApp.getUi().alert("Compra de fio atualizada com sucesso!");
  }
  
  return "Compra de fio atualizada com sucesso!";
}

/**
 * copyCompraToHistorico: Copia os dados da aba COMPRA DE FIO para a aba HISTORICO, adicionando a data/hora atual.
 */
function copyCompraToHistorico() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetCompra = ss.getSheetByName("COMPRA DE FIO");
  var historicoSheet = ss.getSheetByName("HISTORICO");
  if (!historicoSheet) {
    historicoSheet = ss.insertSheet("HISTORICO");
  }
  
  var numRowsToCopy = sheetCompra.getLastRow() - 1;
  Logger.log("Número de linhas para copiar: " + numRowsToCopy);
  if (numRowsToCopy > 0) {
    var compData = sheetCompra.getRange(2, 1, numRowsToCopy, 7).getValues();
    var now = new Date();
    var historicoData = compData.map(function(row) {
      return row.concat([now]);
    });
    var lastRowHistorico = historicoSheet.getLastRow();
    var startRowHistorico = lastRowHistorico < 1 ? 1 : lastRowHistorico + 1;
    historicoSheet.getRange(startRowHistorico, 1, historicoData.length, historicoData[0].length).setValues(historicoData);
    Logger.log("Dados copiados para HISTORICO a partir da linha " + startRowHistorico);
  } else {
    Logger.log("Não há linhas para copiar na aba COMPRA DE FIO.");
  }
}

/**
 * atualizarCompraDeFioEHistorico: Executa atualizarCompraDeFio() e, em seguida, copyCompraToHistorico().
 */
function atualizarCompraDeFioEHistorico() {
  atualizarCompraDeFio();
  copyCompraToHistorico();
}

/**
 * showEstoqueSidebar: Abre o formulário de cadastro de estoque na sidebar.
 */
function showEstoqueSidebar() {
  var nextRow = updateUnprotectedRange();
  Logger.log("showEstoqueSidebar: Próxima linha para cadastro: " + nextRow);
  
  var template = HtmlService.createTemplateFromFile("DialogEstoque");
  template.itemList = JSON.stringify(getItemList());
  template.groupList = JSON.stringify(getGroupList());
  template.nfList = JSON.stringify(getNfList());
  template.obsList = JSON.stringify(getObsList());
  template.currentRow = nextRow;
  
  var htmlOutput = template.evaluate().setTitle("CADASTRO DE ESTOQUE");
  SpreadsheetApp.getUi().showSidebar(htmlOutput);
}

/**
 * updateUnprotectedRange: Retorna a próxima linha livre na aba ESTOQUE.
 */
function updateUnprotectedRange() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  var nextRow = sheet.getLastRow() + 1;
  return nextRow;
}

/**
 * setActiveNextEmptyCell: Seleciona a célula da coluna A que está 15 linhas abaixo da última preenchida.
 */
function setActiveNextEmptyCell() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (sheet) {
    var nextRow = sheet.getLastRow() + 15;
    sheet.activate();
    sheet.setActiveSelection("A" + nextRow);
    Logger.log("setActiveNextEmptyCell: Célula A" + nextRow + " selecionada.");
  }
}

/**
 * select4RowsBelow: Seleciona a célula da coluna A que está 4 linhas abaixo da última linha preenchida.
 */
function select4RowsBelow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (sheet) {
    var nextRow = sheet.getLastRow() + 4;
    sheet.activate();
    sheet.setActiveSelection("A" + nextRow);
    Logger.log("select4RowsBelow: Célula A" + nextRow + " selecionada.");
  }
}

/**
 * select10RowsBelow: Seleciona a célula da coluna A que está 10 linhas abaixo da última linha preenchida.
 */
function select10RowsBelow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (sheet) {
    var nextRow = sheet.getLastRow() + 10;
    sheet.activate();
    sheet.setActiveSelection("A" + nextRow);
    Logger.log("select10RowsBelow: Célula A" + nextRow + " selecionada.");
  }
}

/**
 * getItemList: Retorna a lista única de itens da aba DADOS (Coluna A).
 */
function getItemList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetDados = ss.getSheetByName("DADOS");
  if (!sheetDados) return [];
  var lastRowDados = sheetDados.getLastRow();
  if (lastRowDados < 1) return [];
  var values = sheetDados.getRange(1, 1, lastRowDados, 1).getValues().flat();
  var items = [];
  for (var i = 0; i < values.length; i++) {
    if (values[i] && values[i].toString().trim() !== "") {
      items.push(values[i].toString().trim());
    }
  }
  return Array.from(new Set(items));
}

/**
 * getGroupList: Retorna a lista única de grupos da aba DADOS (Coluna D).
 */
function getGroupList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetDados = ss.getSheetByName("DADOS");
  if (!sheetDados) return [];
  var lastRowDados = sheetDados.getLastRow();
  if (lastRowDados < 1) return [];
  var values = sheetDados.getRange(1, 4, lastRowDados, 1).getValues().flat();
  var groups = [];
  for (var i = 0; i < values.length; i++) {
    if (values[i] && values[i].toString().trim() !== "") {
      groups.push(values[i].toString().trim());
    }
  }
  return Array.from(new Set(groups));
}

/**
 * getNfList: Retorna a lista única de valores da coluna D da aba ESTOQUE (Nota Fiscal/Pedido).
 */
function getNfList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange("D2:D" + lastRow).getValues().flat();
  var nfList = values.filter(function(v) {
    return v.toString().trim() !== "";
  });
  return Array.from(new Set(nfList));
}

/**
 * getObsList: Retorna a lista única de valores da coluna E da aba ESTOQUE (Cliente/Observações).
 */
function getObsList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange("E2:E" + lastRow).getValues().flat();
  var obsList = values.filter(function(v) {
    return v.toString().trim() !== "";
  });
  return Array.from(new Set(obsList));
}

/**
 * normalize: Função auxiliar para normalizar texto.
 */
function normalize(text) {
  if (!text) return "";
  return text.toString().trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * getLastRegistration: Retorna o último registro de um item na aba "ESPELHO DO ESTOQUE".
 */
function getLastRegistration(item, currentRow) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEspelho = ss.getSheetByName("ESPELHO DO ESTOQUE");
  if (!sheetEspelho) {
    Logger.log("getLastRegistration: Aba ESPELHO DO ESTOQUE não encontrada.");
    return { lastDate: null, lastStock: 0 };
  }
  var lastRowEspelho = sheetEspelho.getLastRow();
  var result = { lastDate: null, lastStock: 0 };
  if (lastRowEspelho < 2) return result;
  // Lê apenas as 3 colunas usadas (A:C) em vez de todas as colunas da aba.
  var data = sheetEspelho.getRange(1, 1, lastRowEspelho, 3).getValues();
  var alvo = normalize(item);
  
  Logger.log("getLastRegistration: Procurando por " + alvo);
  for (var i = data.length - 1; i >= 1; i--) {
    if ((i + 1) >= currentRow) continue;
    var currentItem = data[i][0];
    if (currentItem && normalize(currentItem) === alvo) {
      result.lastDate = data[i][1];
      result.lastStock = data[i][2];
      Logger.log("getLastRegistration: Encontrado na linha " + (i + 1) + " com Data=" + result.lastDate + " e Estoque=" + result.lastStock);
      break;
    }
  }
  return result;
}

/**
 * getLastInfoFromDados: Retorna a última informação não vazia da coluna C da aba DADOS para um produto.
 */
function getLastInfoFromDados(product) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetDados = ss.getSheetByName("DADOS");
  if (!sheetDados) return "";
  var lastRow = sheetDados.getLastRow();
  if (lastRow < 2) return "";
  var data = sheetDados.getRange(2, 1, lastRow - 1, sheetDados.getLastColumn()).getValues();
  var lastInfo = "";
  for (var i = 0; i < data.length; i++) {
    if (data[i][0].toString().trim() === product && data[i][2].toString().trim() !== "") {
      lastInfo = data[i][2];
    }
  }
  return lastInfo;
}

/**
 * showCustomDialog: Exibe um diálogo HTML customizado com uma mensagem.
 */
function showCustomDialog(message) {
  var template = HtmlService.createTemplateFromFile("CustomDialog");
  template.message = message;
  var html = template.evaluate().setWidth(400).setHeight(200);
  SpreadsheetApp.getUi().showModalDialog(html, "AVISO");
}

/**
 * localizarProduto: Abre o diálogo para localizar um produto.
 */
function localizarProduto() {
  var template = HtmlService.createTemplateFromFile("DialogLocalizarProduto");
  template.produtos = JSON.stringify(getProdutosEstoque());
  var htmlOutput = template.evaluate().setWidth(400).setHeight(300);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, "LOCALIZAR PRODUTO");
}

/**
 * filtrarProduto: Aplica um filtro na aba ESTOQUE para exibir apenas as linhas cujo valor da coluna B seja igual ao produto.
 */
function filtrarProduto(produto) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (sheet.getFilter()) {
    sheet.getFilter().remove();
  }
  var range = sheet.getDataRange();
  var filter = range.createFilter();
  var criteria = SpreadsheetApp.newFilterCriteria().whenTextEqualTo(produto).build();
  filter.setColumnFilterCriteria(2, criteria);
}

/**
 * mostrarTodos: Remove o filtro, ordena a aba ESTOQUE pela data (Coluna C) e seleciona uma célula.
 */
function mostrarTodos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (sheet.getFilter()) {
    sheet.getFilter().remove();
  }
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastColumn).sort({ column: 3, ascending: true });
  }
  setActiveNextEmptyCell();
}

/**
 * abrirDialogRelatorioEstoque: Abre o diálogo para definir a faixa de data do relatório.
 */
function abrirDialogRelatorioEstoque() {
  var html = HtmlService.createTemplateFromFile("DialogRelatorioEstoque")
      .evaluate()
      .setWidth(400)
      .setHeight(300);
  SpreadsheetApp.getUi().showModalDialog(html, "RELATÓRIO DE ESTOQUE");
}

/**
 * gerarRelatorioEstoque: Gera o relatório geral para o período definido.
 */
function gerarRelatorioEstoque(dataInicio, dataFim) {
  Logger.log("gerarRelatorioEstoque: Início " + dataInicio + " - Fim " + dataFim);
  var partsInicio = dataInicio.split("/");
  var partsFim = dataFim.split("/");
  var startDate = new Date(partsInicio[2], partsInicio[1] - 1, partsInicio[0], 0, 0, 0);
  var endDate = new Date(partsFim[2], partsFim[1] - 1, partsFim[0], 23, 59, 59);
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEstoque = ss.getSheetByName("ESTOQUE");
  if (!sheetEstoque) throw new Error("A aba ESTOQUE não foi encontrada.");
  
  var lastRow = sheetEstoque.getLastRow();
  if (lastRow < 2) throw new Error("Não há dados na aba ESTOQUE.");
  
  var lastColumn = sheetEstoque.getLastColumn();
  var dataRange = sheetEstoque.getRange(2, 1, lastRow - 1, lastColumn);
  var dataValues = dataRange.getValues();
  
  var filtered = dataValues.filter(function(row) {
    var dt = parseDataCellEstoque(row[2]);
    return dt !== null && dt >= startDate && dt <= endDate;
  });
  
  var grupos = {};
  filtered.forEach(function(row) {
    var prod = row[1];
    if (!grupos[prod]) {
      grupos[prod] = row;
    } else {
      var currentDate = parseDataCellEstoque(row[2]);
      var storedDate = parseDataCellEstoque(grupos[prod][2]);
      if (storedDate === null || (currentDate !== null && currentDate > storedDate)) {
        grupos[prod] = row;
      }
    }
  });
  
  var reportData = [];
  for (var prod in grupos) {
    var row = grupos[prod];
    reportData.push([prod, row[8], row[4], row[2]]);
  }
  
  reportData.sort(function(a, b) {
    var da = parseDataCellEstoque(a[3]);
    var db = parseDataCellEstoque(b[3]);
    return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
  });
  
  var sheetRelatorio = ss.getSheetByName("RELATORIO");
  if (!sheetRelatorio) {
    sheetRelatorio = ss.insertSheet("RELATORIO");
    sheetRelatorio.getRange("J1").setValue(0);
  }
  var threshold = parseFloat(sheetRelatorio.getRange("J1").getValue());
  if (isNaN(threshold)) {
    threshold = 0;
  }
  
  for (var i = 0; i < reportData.length; i++) {
    var novoSaldo = parseFloat(reportData[i][1]);
    if (novoSaldo < threshold) {
      reportData[i].push("URGENTE");
    } else {
      reportData[i].push("ESTOQUE");
    }
  }
  
  sheetRelatorio.clearContents();
  sheetRelatorio.getRange("J1").setValue(threshold);
  sheetRelatorio.getRange(1, 1, 1, 5).setValues([["PRODUTO", "NOVO SALDO", "OBS", "DATA/HORA", "STATUS"]]);
  if (reportData.length > 0) {
    sheetRelatorio.getRange(2, 1, reportData.length, 5).setValues(reportData);
  }
  
  var relFilter = sheetRelatorio.getFilter();
  if (relFilter) {
    relFilter.remove();
  }
  sheetRelatorio.getRange(1, 1, sheetRelatorio.getLastRow(), 5).createFilter();
  
  Logger.log("gerarRelatorioEstoque: Relatório gerado com " + reportData.length + " registros.");
  return "Relatório gerado com sucesso!";
}

/**
 * abrirDialogRelatorioPorGrupo: Abre o diálogo para definir o grupo do relatório.
 */
function abrirDialogRelatorioPorGrupo() {
  var template = HtmlService.createTemplateFromFile("DialogRelatorioPorGrupo");
  template.grupos = JSON.stringify(getGruposEstoque());
  var htmlOutput = template.evaluate().setWidth(400).setHeight(300);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, "RELATÓRIO POR GRUPO");
}

/**
 * getGruposEstoque: Retorna os grupos únicos da aba ESTOQUE (Coluna A).
 */
function getGruposEstoque() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange("A2:A" + lastRow).getValues().flat();
  var grupos = values.filter(function(v) {
    return v.toString().trim() !== "";
  });
  return Array.from(new Set(grupos));
}

/**
 * gerarRelatorioPorGrupo: Gera o relatório para um grupo específico.
 */
function gerarRelatorioPorGrupo(grupoSelecionado) {
  Logger.log("gerarRelatorioPorGrupo: Grupo selecionado: " + grupoSelecionado);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEstoque = ss.getSheetByName("ESTOQUE");
  if (!sheetEstoque) throw new Error("A aba ESTOQUE não foi encontrada.");
  
  var lastRow = sheetEstoque.getLastRow();
  if (lastRow < 2) throw new Error("Não há dados na aba ESTOQUE.");
  
  var lastColumn = sheetEstoque.getLastColumn();
  var dataRange = sheetEstoque.getRange(2, 1, lastRow - 1, lastColumn);
  var dataValues = dataRange.getValues();
  
  var filtered = dataValues.filter(function(row) {
    return row[0].toString().trim() === grupoSelecionado;
  });
  
  var gruposItens = {};
  filtered.forEach(function(row) {
    var item = row[1];
    if (!gruposItens[item]) {
      gruposItens[item] = row;
    } else {
      var currentDate = parseDataCellEstoque(row[2]);
      var storedDate = parseDataCellEstoque(gruposItens[item][2]);
      if (storedDate === null || (currentDate !== null && currentDate > storedDate)) {
        gruposItens[item] = row;
      }
    }
  });
  
  var reportData = [];
  for (var item in gruposItens) {
    var row = gruposItens[item];
    reportData.push([row[0], row[1], row[8], row[2]]);
  }
  
  reportData.sort(function(a, b) {
    var da = parseDataCellEstoque(a[3]);
    var db = parseDataCellEstoque(b[3]);
    return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
  });
  
  var sheetRelatorio = ss.getSheetByName("RELATORIO POR GRUPO DE ITEM");
  if (!sheetRelatorio) {
    sheetRelatorio = ss.insertSheet("RELATORIO POR GRUPO DE ITEM");
  }
  sheetRelatorio.clearContents();
  sheetRelatorio.getRange(1, 1, 1, 4).setValues([["GRUPO", "ITEM", "NOVO SALDO", "DATA/HORA"]]);
  if (reportData.length > 0) {
    sheetRelatorio.getRange(2, 1, reportData.length, 4).setValues(reportData);
  }
  
  Logger.log("gerarRelatorioPorGrupo: Relatório gerado com " + reportData.length + " registros.");
  return "Relatório por grupo gerado com sucesso!";
}


/* ================================
   NOVAS FUNÇÕES: Estoque por Período e Limpar Filtro
   ================================ */

/**
 * abrirDialogEstoquePorPeriodo: Abre um diálogo para que o usuário informe as datas de início e fim.
 */
function abrirDialogEstoquePorPeriodo() {
  var html = HtmlService.createTemplateFromFile("DialogEstoquePorPeriodo")
    .evaluate()
    .setWidth(350)
    .setHeight(250);
  SpreadsheetApp.getUi().showModalDialog(html, "Filtrar Estoque por Período");
}

/**
 * filtrarEstoquePorPeriodo: Copia as linhas da aba ESTOQUE, cuja data na coluna C
 * esteja entre dataInicio e dataFim (formato dd/mm/yyyy), e as cola na aba "FILTRO POR PERIODO".
 * Antes de colar, apaga o conteúdo anterior da aba.
 */
function filtrarEstoquePorPeriodo(dataInicio, dataFim) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEstoque = ss.getSheetByName("ESTOQUE");
  if (!sheetEstoque) throw new Error("A aba ESTOQUE não foi encontrada.");
  
  var lastRow = sheetEstoque.getLastRow();
  if (lastRow < 2) throw new Error("Não há dados na aba ESTOQUE.");
  
  // Divide as datas informadas (formato dd/mm/yyyy) em partes e cria objetos Date.
  var partsInicio = dataInicio.split("/");
  var partsFim = dataFim.split("/");
  if (partsInicio.length !== 3 || partsFim.length !== 3) {
    throw new Error("Formato de data inválido. Use dd/mm/yyyy");
  }
  
  var startDate = new Date(
    parseInt(partsInicio[2], 10), 
    parseInt(partsInicio[1], 10) - 1, 
    parseInt(partsInicio[0], 10)
  );
  
  var endDate = new Date(
    parseInt(partsFim[2], 10), 
    parseInt(partsFim[1], 10) - 1, 
    parseInt(partsFim[0], 10),
    23, 59, 59, 999
  );
  
  // Obtém os dados da aba ESTOQUE (assumindo que a primeira linha é o cabeçalho)
  var dataRange = sheetEstoque.getRange(2, 1, lastRow - 1, sheetEstoque.getLastColumn());
  var dataValues = dataRange.getValues();
  
  // Prepara a aba de destino "FILTRO POR PERIODO"
  var sheetFiltro = ss.getSheetByName("FILTRO POR PERIODO");
  if (!sheetFiltro) {
    sheetFiltro = ss.insertSheet("FILTRO POR PERIODO");
  } else {
    // Apaga todo o conteúdo da aba, inclusive formatação e filtros antigos.
    sheetFiltro.clear();
  }
  
  // Copia o cabeçalho da aba ESTOQUE para a aba "FILTRO POR PERIODO"
  var header = sheetEstoque.getRange(1, 1, 1, sheetEstoque.getLastColumn()).getValues();
  sheetFiltro.getRange(1, 1, 1, header[0].length).setValues(header);
  
  var targetData = [];
  
  // Percorre cada linha e copia as que tiverem data na coluna C (índice 2) dentro do período
  for (var i = 0; i < dataValues.length; i++) {
    var row = dataValues[i];
    var dateValue = row[2]; // Coluna C
    // Verifica se o valor é uma data válida
    if (!(dateValue instanceof Date)) continue;
    if (dateValue >= startDate && dateValue <= endDate) {
      targetData.push(row);
    }
  }
  
  // Copia os dados filtrados para a aba "FILTRO POR PERIODO", a partir da linha 2
  if (targetData.length > 0) {
    sheetFiltro.getRange(2, 1, targetData.length, targetData[0].length).setValues(targetData);
  }
  
  // Ordena os dados (exceto o cabeçalho) pela coluna C em ordem crescente
  var targetLastRow = sheetFiltro.getLastRow();
  if (targetLastRow > 1) {
    sheetFiltro.getRange(2, 1, targetLastRow - 1, sheetFiltro.getLastColumn())
              .sort({ column: 3, ascending: true });
  }
  
  return "Dados do período de " + dataInicio + " a " + dataFim + " foram copiados para a aba 'FILTRO POR PERIODO'.";
}

/**
 * limparFiltroEstoque: Remove o filtro da aba ESTOQUE, ordena pela coluna C (datas) de forma ascendente
 * e seleciona a célula 4 linhas abaixo da última linha preenchida.
 */
function limparFiltroEstoque() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (!sheet) throw new Error("A aba ESTOQUE não foi encontrada.");
  
  if (sheet.getFilter()) {
    sheet.getFilter().remove();
  }
  
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).sort({ column: 3, ascending: true });
  }
  
  select4RowsBelow();
  
  return "Filtro removido e planilha ordenada por data.";
}

/**
 * convertDateFormat: Converte uma data do formato dd/mm/yyyy para mm/dd/yyyy.
 */
function convertDateFormat(dateStr) {
  var parts = dateStr.split("/");
  if (parts.length !== 3) throw new Error("Data inválida: " + dateStr);
  return parts[1] + "/" + parts[0] + "/" + parts[2];
}

/* ================================
   NOVAS FUNÇÕES: Estoque 3 Meses
   ================================ */

/**
 * showEstoque3MesesSidebar: Abre um sidebar para que o usuário insira até 10 itens para análise dos últimos 3 meses.
 */
function showEstoque3MesesSidebar() {
  var html = HtmlService.createTemplateFromFile("DialogEstoque3Meses");
  html.itemList = JSON.stringify(getItemList());
  html = html.evaluate().setTitle("Estoque 3 Meses").setWidth(350).setHeight(400);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Para uma lista de itens colada via sidebar, acumula os valores da aba "ESPELHO DO ESTOQUE"
 * dos últimos 3 meses e exibe o total para cada item na aba "CONSUMO 3 MESES",
 * além de buscar os lotes de tingimento correspondentes.
 */
function processEstoque3Meses(formData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEsp = ss.getSheetByName("ESPELHO DO ESTOQUE");
  var sheetBase = ss.getSheetByName("BASE TINGIMENTO");
  var sheetCons = ss.getSheetByName("CONSUMO 3 MESES") || ss.insertSheet("CONSUMO 3 MESES");

  // 1. Pega a lista de itens colada na área de texto e a processa
  var pastedText = formData.itemList || '';
  var items = pastedText.split('\n')
                       .map(function(item) { return item.trim(); })
                       .filter(function(item) { return item.length > 0; });
  
  if (items.length === 0) {
    throw new Error("Cole pelo menos um item na área de texto.");
  }
  items = Array.from(new Set(items)); 
  
  // 2) Soma consumo dos últimos 3 meses (coluna D do espelho)
  var today = new Date();
  var threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate());
  var espData = sheetEsp
    .getRange(2, 1, sheetEsp.getLastRow() - 1, sheetEsp.getLastColumn())
    .getValues();

  var consumos = items.map(function(it) {
    var total = 0;
    espData.forEach(function(r) {
      if (r[0] && r[0].toString().trim().toLowerCase() === it.toLowerCase()) {
        var dt = (r[1] instanceof Date) ? r[1] : new Date(r[1]);
        if (dt >= threeMonthsAgo && dt <= today) {
          total += parseFloat(r[3]) || 0;
        }
      }
    });
    return { item: it, total: total };
  });

  // 3) Carrega padrões da BASE TINGIMENTO e fallback
  var baseAll = sheetBase
    .getRange(2, 1, sheetBase.getLastRow() - 1, sheetBase.getLastColumn())
    .getValues();
  var base = baseAll.map(function(r) {
    return {
      pattern: String(r[0]).trim().toLowerCase(),
      values:  r.slice(2).map(function(c) { return parseFloat(c) || 0; })
    };
  });
  var fallbackValues = baseAll[1].slice(2).map(function(c) { return parseFloat(c) || 0; });

  // 4) Para cada consumo, encontra padrão e pega 8 valores mais próximos
  consumos.forEach(function(c) {
    var text = c.item.toLowerCase();
    var match = base
      .filter(function(b) { return b.pattern && text.indexOf(b.pattern) !== -1; })
      .sort(function(a, b) { return b.pattern.length - a.pattern.length; })[0];

    var source = match ? match.values : fallbackValues;
    var diffs = source
      .map(function(v) { return { v: v, d: Math.abs(v - c.total) }; })
      .sort(function(a, b) { return a.d - b.d; })
      .slice(0, 8)
      .map(function(o) { return o.v; });

    for (var j = 0; j < 8; j++) {
      c['s' + (j + 1)] = diffs[j] !== undefined ? diffs[j] : '';
    }
  });

  // 5) Grava na planilha CONSUMO 3 MESES
  var headers = ['Item', 'Total últimos 3 meses'];
  for (var k = 1; k <= 8; k++) headers.push('LOTE TINGIMENTO ' + k);

  sheetCons.clearContents();
  sheetCons.getRange(1, 1, 1, headers.length).setValues([headers]);

  var out = consumos.map(function(c) {
    var row = [c.item, c.total];
    for (var m = 1; m <= 8; m++) row.push(c['s' + m]);
    return row;
  });
  if (out.length) {
    sheetCons.getRange(2, 1, out.length, headers.length).setValues(out);
  }

  var lastRow = sheetCons.getLastRow();
  var lastCol = headers.length;
  sheetCons.getRange(1, 1, lastRow, lastCol).setHorizontalAlignment("center");
  sheetCons.autoResizeColumns(1, lastCol);

  // =================================================================
  // --- PASSO 6 MODIFICADO: Monta e retorna tabela HTML BEM FORMATADA ---
  // =================================================================
  var html = `
    <style>
      .results-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      .results-table th, .results-table td {
        border: 1px solid #ccc;
        padding: 6px;
        text-align: center;
      }
      .results-table th {
        background-color: #f2f2f2;
        font-weight: bold;
      }
      .results-table td:first-child, .results-table th:first-child {
        text-align: left; /* Alinha a primeira coluna (Item) à esquerda */
      }
    </style>
  `;

  html += '<table class="results-table"><tr>';
  headers.forEach(function(h) { html += '<th>' + h + '</th>'; });
  html += '</tr>';
  out.forEach(function(r) {
    html += '<tr>';
    // Formata a célula do total para ter zero casas decimais
    var totalFormatado = Math.round(r[1]);
    html += '<td>' + r[0] + '</td>';
    html += '<td>' + totalFormatado + '</td>';
    // Adiciona as outras células (lotes de tingimento)
    for (var i = 2; i < r.length; i++) {
        html += '<td>' + r[i] + '</td>';
    }
    html += '</tr>';
  });
  html += '</table>';
  return html;
}


/* ================================
   NOVAS FUNÇÕES: Cores Desatualizadas
   ================================ */

/**
 * processCoresDesatualizadas: A partir de uma data informada (formato dd/mm/yyyy),
 * procura na aba ESTOQUE as linhas marcadas de vermelho (verificando a cor da primeira célula)
 * e, para cada item (coluna A), agrupa os registros cuja data (coluna C) seja >= data informada.
 * Para cada item, pega as últimas 5 linhas (baseadas na data) e copia somente o valor da coluna B
 * para a aba "CORES DESATUALIZADAS", a partir da coluna E, com o cabeçalho "CORES DESATUALIZADAS".
 * Além disso, na célula F1 da aba "CORES DESATUALIZADAS" é exibida a data informada.
 */
function processCoresDesatualizadas(startDateStr) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Converte a data informada (dd/mm/yyyy) para objeto Date
  var startDate = parseDateBR(startDateStr);
  if (!startDate || isNaN(startDate)) {
    throw new Error("Data de início inválida: use o formato dd/mm/yyyy.");
  }
  
  var sheetEstoque = ss.getSheetByName("ESTOQUE");
  if (!sheetEstoque) throw new Error("A aba ESTOQUE não foi encontrada.");
  
  var lastRow = sheetEstoque.getLastRow();
  var lastCol = sheetEstoque.getLastColumn();
  if (lastRow < 2) throw new Error("Não há dados na aba ESTOQUE.");
  
  // Lê os dados e os backgrounds (exceto o cabeçalho)
  var dataRange = sheetEstoque.getRange(2, 1, lastRow - 1, lastCol);
  var dadosValues = dataRange.getValues();
  var backgrounds = dataRange.getBackgrounds();
  
  // Cria um objeto para agrupar os registros por item (chave em lowercase)
  var grupos = {};
  
  // Percorre cada linha para verificar se está marcada de vermelho na primeira célula
  // e se a data na coluna C é >= startDate.
  for (var i = 0; i < dadosValues.length; i++) {
    var bg = backgrounds[i][0].toLowerCase();
    if (bg !== "red" && bg !== "#ff0000") continue;
    
    var row = dadosValues[i];
    var item = row[0] ? row[0].toString().trim() : "";
    if (item === "") continue;
    
    // Data na coluna C (índice 2)
    var dataCell = row[2];
    if (!(dataCell instanceof Date)) {
      dataCell = parseDateBR(dataCell);
    }
    if (!(dataCell instanceof Date) || isNaN(dataCell)) continue;
    if (dataCell < startDate) continue;
    
    var key = item.toLowerCase();
    if (!grupos[key]) {
      grupos[key] = [];
    }
    grupos[key].push({ row: row, date: dataCell });
  }
  
  // Para cada item, ordena os registros por data decrescente e pega as últimas 5 linhas
  var resultados = [];
  for (var key in grupos) {
    if (grupos.hasOwnProperty(key)) {
      var registros = grupos[key];
      registros.sort(function(a, b) {
        return b.date - a.date;
      });
      var ultimos5 = registros.slice(0, 5);
      ultimos5.reverse(); // Exibe do mais antigo para o mais recente
      for (var j = 0; j < ultimos5.length; j++) {
        // Copia somente o valor da coluna B (índice 1)
        resultados.push([ultimos5[j].row[1]]);
      }
    }
  }
  
  // --- Parte 3: Copia os resultados para a aba CORES DESATUALIZADAS na coluna E ---
  var sheetCores = ss.getSheetByName("CORES DESATUALIZADAS");
  if (!sheetCores) {
    sheetCores = ss.insertSheet("CORES DESATUALIZADAS");
  } else {
    sheetCores.clear();
  }
  
  // Define o cabeçalho na coluna E
  var header = [["CORES DESATUALIZADAS"]];
  sheetCores.getRange(1, 5, 1, header[0].length).setValues(header);
  
  if (resultados.length > 0) {
    var resultRange = sheetCores.getRange(2, 5, resultados.length, resultados[0].length);
    resultRange.setValues(resultados);
    // Define o fundo de todas as linhas copiadas como vermelho
    resultRange.setBackground("red");
  }
  
  // Exibe a data informada na célula F1
  sheetCores.getRange("F1").setValue(startDateStr);
  
  return "Valores da coluna B para os itens em vermelho a partir de " + startDateStr + " foram copiados para a aba 'CORES DESATUALIZADAS' na coluna E, e a data foi registrada em F1.";
}

/**
 * parseDateBR: Converte uma string no formato dd/mm/yyyy para um objeto Date.
 */
function parseDateBR(dateStr) {
  if (typeof dateStr === 'string') {
    var parts = dateStr.split("/");
    if (parts.length === 3) {
      return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    }
  }
  return new Date(dateStr);
}

/* ================================
   NOVAS FUNÇÕES: Cores Desatualizadas - Diálogo
   ================================ */
function showCoresDesatualizadasDialog() {
  var html = HtmlService.createTemplateFromFile("DialogCoresDesatualizadas")
    .evaluate()
    .setWidth(300)
    .setHeight(150);
  SpreadsheetApp.getUi().showModalDialog(html, "Filtrar Cores Desatualizadas");
}
/**
 * processRepeticoesCoresDesatualizadas:
 * Lê a data definida na célula F1 da aba CORES DESATUALIZADAS e os cadastros inseridos na coluna E.
 * Em seguida, na aba ESPELHO DO ESTOQUE, para cada cadastro encontrado em CORES DESATUALIZADAS (coluna E),
 * busca todos os registros cujo cadastro (coluna A) corresponda (comparação case-insensitive)
 * e cuja data na coluna B seja menor ou igual à data definida.
 * Os registros encontrados são copiados para a aba CORES DESATUALIZADAS, onde:
 *  - Coluna A: Cadastro
 *  - Coluna B: Data (da ESPELHO DO ESTOQUE)
 *  - Coluna C: Informação (da ESPELHO DO ESTOQUE, coluna E)
 */
function processRepeticoesCoresDesatualizadas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Obtém a aba CORES DESATUALIZADAS
  var sheetCores = ss.getSheetByName("CORES DESATUALIZADAS");
  if (!sheetCores) throw new Error("A aba CORES DESATUALIZADAS não foi encontrada.");
  
  // Lê a data definida na célula F1 (deve estar no formato dd/mm/yyyy)
  var dataF1Raw = sheetCores.getRange("F1").getValue();
  var dataF1 = parseDateBR(dataF1Raw.toString());
  if (!dataF1 || isNaN(dataF1)) {
    throw new Error("Data em F1 inválida. Certifique-se de que está no formato dd/mm/yyyy.");
  }
  
  // Lê os cadastros da coluna E (a partir da linha 2)
  var lastRowCores = sheetCores.getLastRow();
  if (lastRowCores < 2) throw new Error("Não há cadastros na coluna E da aba CORES DESATUALIZADAS.");
  var rangeCadastros = sheetCores.getRange(2, 5, lastRowCores - 1, 1);
  var cadastrosData = rangeCadastros.getValues();
  
  // Armazena os cadastros únicos (usando lowercase para comparação)
  var cadastros = {};
  for (var i = 0; i < cadastrosData.length; i++) {
    var val = cadastrosData[i][0];
    if (val && val.toString().trim() !== "") {
      cadastros[val.toString().trim().toLowerCase()] = val.toString().trim();
    }
  }
  
  // Acessa a aba ESPELHO DO ESTOQUE
  var sheetEspelho = ss.getSheetByName("ESPELHO DO ESTOQUE");
  if (!sheetEspelho) throw new Error("A aba ESPELHO DO ESTOQUE não foi encontrada.");
  var lastRowEspelho = sheetEspelho.getLastRow();
  var lastColEspelho = sheetEspelho.getLastColumn();
  if (lastRowEspelho < 2) throw new Error("Não há dados na aba ESPELHO DO ESTOQUE.");
  var rangeEspelho = sheetEspelho.getRange(2, 1, lastRowEspelho - 1, lastColEspelho);
  var espelhoValues = rangeEspelho.getValues();
  
  var resultados = [];
  
  // Percorre cada registro da aba ESPELHO DO ESTOQUE
  // Assumindo que:
  // - Coluna A: Cadastro
  // - Coluna B: Data
  // - Coluna E: Informação
  for (var j = 0; j < espelhoValues.length; j++) {
    var row = espelhoValues[j];
    var cadastroEspelho = row[0] ? row[0].toString().trim() : "";
    if (cadastroEspelho === "") continue;
    var key = cadastroEspelho.toLowerCase();
    if (!(key in cadastros)) continue;
    
    // Data na ESPELHO DO ESTOQUE (coluna B, índice 1)
    var dataEspelho = row[1];
    if (!(dataEspelho instanceof Date)) {
      dataEspelho = parseDateBR(dataEspelho);
    }
    if (!(dataEspelho instanceof Date) || isNaN(dataEspelho)) continue;
    // Considera registros cuja data seja <= data definida (F1)
    if (dataEspelho > dataF1) continue;
    
    // Extrai:
    // Coluna A: Cadastro, Coluna B: Data, Coluna C: Informação (da coluna E da aba ESPELHO)
    var info = row[4]; // Coluna E
    resultados.push([cadastroEspelho, dataEspelho, info]);
  }
  
  // Agora, vamos limpar a aba CORES DESATUALIZADAS e inserir esses resultados nas colunas A, B e C.
  sheetCores.clear();
  // Define o cabeçalho
  sheetCores.getRange(1, 1, 1, 3).setValues([["Cadastro", "Data", "Informação"]]);
  
  if (resultados.length > 0) {
    sheetCores.getRange(2, 1, resultados.length, 3).setValues(resultados);
  }
  
  return "Registros até " + dataF1Raw + " foram copiados para a aba 'CORES DESATUALIZADAS' (Colunas A:C).";
}

/**
 * parseDateBR: Converte uma string no formato dd/mm/yyyy para um objeto Date.
 */
function parseDateBR(dateStr) {
  if (typeof dateStr === 'string') {
    var parts = dateStr.split("/");
    if (parts.length === 3) {
      return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    }
  }
  return new Date(dateStr);
}
/**
 * processConsultaAtualizacoes:
 * Lê a data de corte da célula F1 da aba CORES DESATUALIZADAS e os itens (cadastros) da coluna E.
 * Em seguida, na aba ESPELHO DO ESTOQUE, para cada registro, se o cadastro (coluna B)
 * corresponder (case-insensitive) a um dos itens e se a data (coluna C) for menor ou igual à data de corte,
 * extrai:
 *    - Cadastro (da coluna B),
 *    - Data (da coluna C),
 *    - Valor (da coluna E).
 * Os resultados são escritos na aba CORES DESATUALIZADAS, a partir da linha 2, nas colunas A, B e C.
 */
function processConsultaAtualizacoes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Acessa a aba CORES DESATUALIZADAS
  var sheetCores = ss.getSheetByName("CORES DESATUALIZADAS");
  if (!sheetCores) throw new Error("A aba CORES DESATUALIZADAS não foi encontrada.");
  
  // Lê a data de corte da célula F1 (formato dd/mm/yyyy)
  var cutoffRaw = sheetCores.getRange("F1").getValue();
  var cutoffDate = parseDateBR(cutoffRaw.toString());
  if (!cutoffDate || isNaN(cutoffDate)) {
    throw new Error("Data de corte em F1 inválida. Certifique-se de que está no formato dd/mm/yyyy.");
  }
  
  // Lê os itens (cadastros) da coluna E, a partir da linha 2
  var lastRowCores = sheetCores.getLastRow();
  if (lastRowCores < 2) throw new Error("Não há cadastros na coluna E da aba CORES DESATUALIZADAS.");
  var rangeItems = sheetCores.getRange(2, 5, lastRowCores - 1, 1);
  var itemsData = rangeItems.getValues();
  
  var queryItems = [];
  for (var i = 0; i < itemsData.length; i++) {
    var val = itemsData[i][0];
    if (val && val.toString().trim() !== "") {
      queryItems.push(val.toString().trim().toLowerCase());
    }
  }
  
  // Acessa a aba ESPELHO DO ESTOQUE
  var sheetEspelho = ss.getSheetByName("ESPELHO DO ESTOQUE");
  if (!sheetEspelho) throw new Error("A aba ESPELHO DO ESTOQUE não foi encontrada.");
  var lastRowEspelho = sheetEspelho.getLastRow();
  var lastColEspelho = sheetEspelho.getLastColumn();
  if (lastRowEspelho < 2) throw new Error("Não há dados na aba ESPELHO DO ESTOQUE.");
  
  var rangeEspelho = sheetEspelho.getRange(2, 1, lastRowEspelho - 1, lastColEspelho);
  var espelhoValues = rangeEspelho.getValues();
  
  var resultados = [];
  
  // Percorre os registros da aba ESPELHO DO ESTOQUE
  // Assumindo que:
  // - Coluna B (índice 1) contém o cadastro (para comparação)
  // - Coluna C (índice 2) contém a data
  // - Coluna E (índice 4) contém o valor
  for (var j = 0; j < espelhoValues.length; j++) {
    var row = espelhoValues[j];
    var cadastroEspelho = row[1] ? row[1].toString().trim() : "";
    if (cadastroEspelho === "") continue;
    var cadastroKey = cadastroEspelho.toLowerCase();
    if (queryItems.indexOf(cadastroKey) === -1) continue;
    
    var dataEspelho = row[2];
    if (!(dataEspelho instanceof Date)) {
      dataEspelho = parseDateBR(dataEspelho);
    }
    if (!(dataEspelho instanceof Date) || isNaN(dataEspelho)) continue;
    // Só traz se a data for menor ou igual à data de corte
    if (dataEspelho > cutoffDate) continue;
    
    var valor = row[4]; // Valor da coluna E
    resultados.push([cadastroEspelho, dataEspelho, valor]);
  }
  
  // --- Escreve os resultados na aba CORES DESATUALIZADAS nas colunas A, B e C ---
  // Limpa as colunas A, B e C
  sheetCores.getRange("A:C").clearContent();
  // Define o cabeçalho
  sheetCores.getRange(1, 1, 1, 3).setValues([["Cadastro", "Data", "Valor"]]);
  
  if (resultados.length > 0) {
    sheetCores.getRange(2, 1, resultados.length, 3).setValues(resultados);
  }
  
  return "Consulta atualizações concluída. Registros encontrados: " + resultados.length;
}

/**
 * parseDateBR: Converte uma string no formato dd/mm/yyyy para um objeto Date.
 */
function parseDateBR(dateStr) {
  if (typeof dateStr === 'string') {
    var parts = dateStr.split("/");
    if (parts.length === 3) {
      return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    }
  }
  return new Date(dateStr);
}
/**
 * consultaAtualizacao: Para cada item informado via formulário (até 10),
 * filtra os registros da aba "ESPELHO DO ESTOQUE" dos últimos 20 dias e
 * retorna os 5 registros mais recentes individualmente, gravando os resultados
 * na aba "CORES DESATUALIZADAS".
 *
 * Supõe-se que na aba "ESPELHO DO ESTOQUE":
 *   - Coluna A: Item
 *   - Coluna B: Data
 *   - Coluna D: Valor
 *   - Coluna E: Valor Adicional
 *
 * Os resultados serão escritos na aba "CORES DESATUALIZADAS" com:
 *   - Coluna A: Item
 *   - Coluna B: Data
 *   - Coluna C: Valor (coluna D do ESPELHO)
 *   - Coluna D: Valor adicional (coluna E do ESPELHO)
 */
function consultaAtualizacao(formData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Calcula o período: hoje e 20 dias atrás
  var today = new Date();
  var twentyDaysAgo = new Date(today.getTime() - 20 * 24 * 3600 * 1000);
  Logger.log("Hoje: " + today);
  Logger.log("20 dias atrás: " + twentyDaysAgo);
  
  // Obtém os itens informados no formulário (até 10) e converte para lowercase
  var itemsSelecionados = [];
  for (var i = 1; i <= 10; i++) {
    var value = formData["item" + i];
    if (value && value.trim() !== "") {
      itemsSelecionados.push(value.trim().toLowerCase());
    }
  }
  Logger.log("Itens selecionados: " + itemsSelecionados.join(", "));
  
  // Acessa a aba "ESPELHO DO ESTOQUE"
  var sheetEspelho = ss.getSheetByName("ESPELHO DO ESTOQUE");
  if (!sheetEspelho) throw new Error("A aba 'ESPELHO DO ESTOQUE' não foi encontrada.");
  
  var lastRowEspelho = sheetEspelho.getLastRow();
  if (lastRowEspelho < 2) throw new Error("Não há dados na aba 'ESPELHO DO ESTOQUE'.");
  
  var dadosRange = sheetEspelho.getRange(2, 1, lastRowEspelho - 1, sheetEspelho.getLastColumn());
  var dadosValues = dadosRange.getValues();
  Logger.log("Total de registros lidos (Espelho): " + dadosValues.length);
  
  var results = [];
  
  // Para cada item informado, filtra os registros que atendem ao critério
  itemsSelecionados.forEach(function(item) {
    // Filtra registros onde:
    // - O valor da coluna A (item) é igual ao item informado (case-insensitive)
    // - A data (coluna B) está entre 20 dias atrás e hoje
    var registros = dadosValues.filter(function(row) {
      var itemNome = row[0] ? row[0].toString().trim().toLowerCase() : "";
      var dataCell = row[1];
      if (!(dataCell instanceof Date)) {
        dataCell = new Date(dataCell);
      }
      return itemNome === item && dataCell >= twentyDaysAgo && dataCell <= today;
    });
    
    // Ordena os registros por data do mais recente para o mais antigo
    registros.sort(function(a, b) {
      return new Date(b[1]) - new Date(a[1]);
    });
    
    // Pega os 5 registros mais recentes (se existirem) e inverte a ordem para exibição cronológica crescente
    var ultimos5 = registros.slice(0, 5);
    ultimos5.reverse();
    
    // Para cada registro, extrai:
    // - Item (coluna A), Data (coluna B), Valor (coluna D – índice 3) e Valor adicional (coluna E – índice 4)
    ultimos5.forEach(function(row) {
      results.push([ row[0], row[1], row[3], row[4] ]);
    });
  });
  
  // Escreve os resultados na aba "CORES DESATUALIZADAS"
  var sheetCores = ss.getSheetByName("CORES DESATUALIZADAS");
  if (!sheetCores) {
    sheetCores = ss.insertSheet("CORES DESATUALIZADAS");
  } else {
    sheetCores.clear(); // Limpa todo o conteúdo existente
  }
  
  // Define o cabeçalho e insere os resultados
  sheetCores.getRange(1, 1, 1, 4).setValues([["Item", "Data", "Valor", "Valor Adicional"]]);
  if (results.length > 0) {
    sheetCores.getRange(2, 1, results.length, 4).setValues(results);
  }
  
  return "Consulta de atualização (20 dias) concluída na aba 'CORES DESATUALIZADAS'.";
}
/**
 * showConsultaAtualizacaoSidebar: Abre uma sidebar com um formulário para inserir 15 itens.
 */
function showConsultaAtualizacaoSidebar() {
  var template = HtmlService.createTemplateFromFile("DialogConsultaAtualizacao");
  var htmlOutput = template.evaluate().setTitle("Consulta Atualização (15 Itens)").setWidth(350).setHeight(500);
  SpreadsheetApp.getUi().showSidebar(htmlOutput);
}
/**
 * gerarListagemCoresDesatualizadas: Para cada item informado via formulário (até 10),
 * busca na aba ESTOQUE os últimos 5 registros onde:
 *   - Coluna B da aba ESTOQUE → Coluna A da aba CORES DESATUALIZADAS,
 *   - Coluna C da aba ESTOQUE → Coluna B,
 *   - Coluna E da aba ESTOQUE → Coluna C.
 * Os registros são inseridos um item abaixo do outro na aba CORES DESATUALIZADAS.
 * Além disso, a função retorna uma tabela HTML com os resultados para ser exibida na sidebar.
 */
function gerarListagemCoresDesatualizadas(formData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEstoque = ss.getSheetByName("ESTOQUE");
  if (!sheetEstoque) throw new Error("A aba ESTOQUE não foi encontrada.");
  
  var lastRow = sheetEstoque.getLastRow();
  if (lastRow < 2) throw new Error("Não há dados na aba ESTOQUE.");
  
  // Lê os dados da aba ESTOQUE (considerando que a primeira linha é cabeçalho)
  var estoqueData = sheetEstoque.getRange(2, 1, lastRow - 1, sheetEstoque.getLastColumn()).getValues();
  
  // Obtém os itens do formulário (até 10 itens)
  var items = [];
  for (var i = 1; i <= 10; i++) {
    var campo = formData["item" + i];
    if (campo && campo.trim() !== "") {
      items.push(campo.trim().toLowerCase());
    }
  }
  if (items.length === 0) throw new Error("Informe pelo menos um item.");
  
  var resultados = [];
  
  // Para cada item, filtra os registros (baseado na coluna B da aba ESTOQUE)
  items.forEach(function(item) {
    var registros = estoqueData.filter(function(row) {
      return row[1] && row[1].toString().trim().toLowerCase() === item;
    });
    // Seleciona os últimos 5 registros e inverte para ordem cronológica crescente
    var ultimos5 = registros.slice(-5);
    ultimos5.reverse();
    ultimos5.forEach(function(row) {
      resultados.push([ row[1], row[2], row[4] ]);
    });
  });
  
  // Escreve os resultados na aba CORES DESATUALIZADAS
  var sheetCores = ss.getSheetByName("CORES DESATUALIZADAS");
  if (!sheetCores) {
    sheetCores = ss.insertSheet("CORES DESATUALIZADAS");
  } else {
    sheetCores.clear();
  }
  
  sheetCores.getRange(1, 1, 1, 3).setValues([["Produto (Coluna B)", "Data (Coluna C)", "Valor Extra (Coluna E)"]]);
  if (resultados.length > 0) {
    sheetCores.getRange(2, 1, resultados.length, 3).setValues(resultados);
  }
  
  // Constrói uma tabela HTML com os resultados para exibição na sidebar
  var htmlOutput = "<h3>Resultados:</h3>";
  if (resultados.length > 0) {
    htmlOutput += "<table border='1' style='border-collapse:collapse; width:100%;'>";
    htmlOutput += "<tr><th>Produto</th><th>Data</th><th>Valor Extra</th></tr>";
    resultados.forEach(function(row) {
      htmlOutput += "<tr>";
      htmlOutput += "<td>" + row[0] + "</td>";
      htmlOutput += "<td>" + row[1] + "</td>";
      htmlOutput += "<td>" + row[2] + "</td>";
      htmlOutput += "</tr>";
    });
    htmlOutput += "</table>";
  } else {
    htmlOutput += "<p>Nenhum registro encontrado.</p>";
  }
  
  return htmlOutput;
}
/**
 * Abre a sidebar para a listagem de cores desatualizadas.
 */
function abrirDialogListagemCores() {
  var template = HtmlService.createTemplateFromFile("DialogListagemCores");
  template.espelhoItems = JSON.stringify(getEspelhoItemList());
  var htmlOutput = template.evaluate()
    .setTitle("Listagem de Cores Desatualizadas")
    .setWidth(350)
    .setHeight(500);
  SpreadsheetApp.getUi().showSidebar(htmlOutput);
}

function getEspelhoItemList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESPELHO DO ESTOQUE");
  if (!sheet) return [];
  var values = sheet.getRange("A:A").getValues().flat();
  var items = [];
  for (var i = 0; i < values.length; i++) {
    if (values[i] && values[i].toString().trim() !== "") {
      items.push(values[i].toString().trim());
    }
  }
  return Array.from(new Set(items));
}

/**
 * Abre a sidebar para Listagem de Estoque, permitindo selecionar até 20 itens.
 */
function showListagemEstoqueSidebar() {
  var ui = SpreadsheetApp.getUi();
  var template = HtmlService.createTemplateFromFile('DialogListagemEstoque');
  // Passa array diretamente, não string JSON
  template.produtos = getProdutosEstoque();
  var html = template.evaluate()
    .setTitle('Listagem de Estoque')
    .setWidth(350);
  ui.showSidebar(html);
}

/**
 * Processa o formulário da sidebar e gera/atualiza a aba "LISTAGEM DE ESTOQUE".
 * Espera até 20 campos: item1...item20
 */
function gerarListagemEstoque(formData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEst = ss.getSheetByName('ESTOQUE');
  if (!sheetEst) throw new Error("Aba 'ESTOQUE' não encontrada.");
  var lastRow = sheetEst.getLastRow();
  if (lastRow < 2) throw new Error("Não há dados na aba 'ESTOQUE'.");

  // Monta lista de itens do formulário (até 20)
  var items = [];
  for (var i = 1; i <= 20; i++) {
    var v = formData['item' + i];
    if (v && v.toString().trim()) items.push(v.toString().trim().toLowerCase());
  }
  if (!items.length) throw new Error("Informe ao menos um item.");

  // Lê dados da aba ESTOQUE
  var dados = sheetEst
    .getRange(2, 1, lastRow - 1, sheetEst.getLastColumn())
    .getValues();

  // Para cada item, encontra saldo e data
  var listagemData = items.map(function(item) {
    var lastSaldo = '', lastDate = '';
    for (var j = dados.length - 1; j >= 0; j--) {
      var prod = dados[j][1] ? dados[j][1].toString().trim().toLowerCase() : '';
      if (prod === item) {
        lastSaldo = dados[j][8];
        lastDate  = dados[j][2];
        break;
      }
    }
    return [item, lastSaldo, lastDate];
  });

  // Escrita na aba LISTAGEM DE ESTOQUE
  var sheetL = ss.getSheetByName('LISTAGEM DE ESTOQUE') || ss.insertSheet('LISTAGEM DE ESTOQUE');
  if (sheetL.getFilter()) sheetL.getFilter().remove();
  sheetL.clearContents();

  sheetL.getRange(1, 1, 1, 3).setValues([['ITEM', 'ÚLTIMO SALDO', 'DATA/HORA']]);
  if (listagemData.length) {
    sheetL.getRange(2, 1, listagemData.length, 3).setValues(listagemData);
  }
  sheetL.getRange(1, 1, sheetL.getLastRow(), 3).createFilter();

  // Retorna HTML para sidebar (opcional)
  var html = '<table style="width:100%;border-collapse:collapse;">'
           + '<tr><th>ITEM</th><th>ÚLTIMO SALDO</th><th>DATA</th></tr>';
  listagemData.forEach(function(r) {
    var dataStr = r[2] instanceof Date
      ? Utilities.formatDate(r[2], Session.getScriptTimeZone(), 'dd/MM/yyyy')
      : r[2] || '';
    html += '<tr>'
         +   '<td>'+r[0]+'</td>'
         +   '<td>'+r[1]+'</td>'
         +   '<td>'+dataStr+'</td>'
         + '</tr>';
  });
  html += '</table>';
  return html;
}

/**
 * Retorna a lista única de produtos (coluna B) da aba ESTOQUE.
 */
function getProdutosEstoque() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('ESTOQUE');
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange('B2:B' + lastRow).getDisplayValues().flat();
  var produtos = values.filter(function(v) { return v.toString().trim() !== ''; });
  return Array.from(new Set(produtos));
}

/**
 * parseDataCellEstoque: Converte o valor da coluna Data (C) da aba ESTOQUE em Date.
 * Células gravadas como TEXTO no formato dd/mm/aaaa (com ou sem hh:mm:ss) — por
 * exemplo, linhas coladas manualmente com a restauração desativada — não são
 * reconhecidas por new Date() (que espera mm/dd/aaaa) e faziam o registro
 * desaparecer silenciosamente dos relatórios por período.
 * Retorna null quando o valor não pode ser interpretado como data.
 */
function parseDataCellEstoque(value) {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string") {
    var m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
      return new Date(
        parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10),
        parseInt(m[4] || "0", 10), parseInt(m[5] || "0", 10), parseInt(m[6] || "0", 10)
      );
    }
  }
  var d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * normalizarDatasColadas: Converte em Date os valores colados como texto nas
 * colunas de data da aba ESTOQUE (C = Data, J = Alterado Em) dentro da faixa
 * editada. Chamada pelo onEdit quando a restauração está desativada, para que
 * colagens manuais não deixem datas em texto (que sumiriam dos relatórios).
 */
function normalizarDatasColadas(range) {
  var sheet = range.getSheet();
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;
  var dateCols = [3, 10]; // C e J
  for (var i = 0; i < dateCols.length; i++) {
    var col = dateCols[i];
    if (col < startCol || col > endCol) continue;
    var colRange = sheet.getRange(range.getRow(), col, range.getNumRows(), 1);
    var values = colRange.getValues();
    var changed = false;
    for (var r = 0; r < values.length; r++) {
      var v = values[r][0];
      if (typeof v === "string" && v.trim() !== "") {
        var d = parseDataCellEstoque(v);
        if (d !== null) {
          values[r][0] = d;
          changed = true;
        }
      }
    }
    if (changed) {
      colRange.setValues(values);
      colRange.setNumberFormat("dd/MM/yyyy HH:mm:ss");
    }
  }
}

/**
 * corrigirDatasEmTexto: Varre toda a aba ESTOQUE (colunas C e J) e converte em
 * Date os valores que estão gravados como texto — limpeza das colagens antigas.
 * Disponível no menu GESTÃO DO ESTOQUE.
 */
function corrigirDatasEmTexto() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ESTOQUE");
  if (!sheet) throw new Error("A aba ESTOQUE não foi encontrada.");
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert("Não há dados na aba ESTOQUE.");
    return;
  }

  PropertiesService.getScriptProperties().setProperty("editingViaScript", "true");
  var total = 0;
  try {
    var dateCols = [3, 10]; // C e J
    for (var i = 0; i < dateCols.length; i++) {
      var colRange = sheet.getRange(2, dateCols[i], lastRow - 1, 1);
      var values = colRange.getValues();
      var changed = false;
      for (var r = 0; r < values.length; r++) {
        var v = values[r][0];
        if (typeof v === "string" && v.trim() !== "") {
          var d = parseDataCellEstoque(v);
          if (d !== null) {
            values[r][0] = d;
            changed = true;
            total++;
          }
        }
      }
      if (changed) {
        colRange.setValues(values);
        colRange.setNumberFormat("dd/MM/yyyy HH:mm:ss");
      }
    }
  } finally {
    PropertiesService.getScriptProperties().deleteProperty("editingViaScript");
  }

  SpreadsheetApp.getUi().alert(
    total > 0
      ? "Correção concluída: " + total + " célula(s) de data em texto convertida(s) em data real."
      : "Nenhuma data em texto encontrada. Está tudo certo!"
  );
}
