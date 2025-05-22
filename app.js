const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const noteList = document.getElementById('note-list');
const graphContainer = document.getElementById('graph');
const snapButton = document.getElementById('snap-toggle');
const snapIcon = document.getElementById('snap-icon');

let notes = JSON.parse(localStorage.getItem('notes')) || {};

if (!notes['Home']) {
  notes['Home'] = '# Home';
  if (!noteOrder.includes('Home')) noteOrder.push('Home');
    saveNotes();
}

let nodes, edges;

let currentNote = 'Home';
let noteOrder = JSON.parse(localStorage.getItem('noteOrder')) || Object.keys(notes);


let network = null;
let nodePositions = JSON.parse(localStorage.getItem('positions') || '{}');

let dragSrcEl = null;
let snapToGrid = false;

marked.setOptions({
  highlight: function(code, lang) {
    const valid = hljs.getLanguage(lang);
    return valid ? hljs.highlight(code, { language: lang }).value : hljs.highlightAuto(code).value;
  }
});


noteList.addEventListener('dragstart', e => {
  dragSrcEl = e.target;
  e.dataTransfer.effectAllowed = 'move';
});

noteList.addEventListener('dragover', e => {
  e.preventDefault();
  const target = e.target.closest('li');
  if (!target || target === dragSrcEl) return;

  const rect = target.getBoundingClientRect();
  const offset = e.clientY - rect.top;

  target.classList.remove('drag-over-top', 'drag-over-bottom');
  if (offset < rect.height / 2) {
    target.classList.add('drag-over-top');
  } else {
    target.classList.add('drag-over-bottom');
  }
});

noteList.addEventListener('dragleave', e => {
  const target = e.target.closest('li');
  if (target) {
    target.classList.remove('drag-over-top', 'drag-over-bottom');
  }
});

noteList.addEventListener('drop', e => {
  e.preventDefault();
  const target = e.target.closest('li');
  if (!target || target === dragSrcEl) return;

  target.classList.remove('drag-over-top', 'drag-over-bottom');

  const noteId = dragSrcEl.dataset.note;
  const targetId = target.dataset.note;

  const fromIndex = noteOrder.indexOf(noteId);
  const toIndex = noteOrder.indexOf(targetId);
  noteOrder.splice(fromIndex, 1);

  const rect = target.getBoundingClientRect();
  const offset = e.clientY - rect.top;
  const insertBefore = offset < rect.height / 2;

  noteOrder.splice(insertBefore ? toIndex : toIndex + 1, 0, noteId);

  localStorage.setItem('noteOrder', JSON.stringify(noteOrder));
  renderNoteList();
});


function parseWikiLinks(text) {
  const links = [...text.matchAll(/\[\[([^\]]+)\]\]/g)];
  return links.map(match => match[1]);
}

function updatePreviewAndGraph() {
  const content = editor.value;
  const processed = content.replace(/\[\[([^\]]+)\]\]/g, (match, linkText) => {
    return `<a href="#" class="wikilink" data-link="${linkText}">${linkText}</a>`;
  });

  preview.innerHTML = marked.parse(processed);

  preview.querySelectorAll('.wikilink').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = e.target.dataset.link;
      openNote(target);
    });
  });



  // Save current note
  notes[currentNote] = content;

  // Auto-create missing linked notes in ALL notes
  Object.entries(notes).forEach(([note, content]) => {
    parseWikiLinks(content).forEach(link => {
      if (!notes[link]) {
        notes[link] = `# ${link}`;
        if (!noteOrder.includes(link)) {
          noteOrder.push(link);
        }

        // Assign a free position to the new node
        nodePositions[link] = findFreePosition(nodePositions);
      }
    });
  });

  localStorage.setItem('notes', JSON.stringify(notes));
  localStorage.setItem('noteOrder', JSON.stringify(noteOrder));


  const nodeData = Object.keys(notes).map(note => {
    const pos = nodePositions[note];
    return {
      id: String(note),
      label: note,
      color: note === currentNote ? '#41DADC' : '#ADADAD',
      x: pos?.x,
      y: pos?.y,
      fixed: false
    };
  });

  const edgeData = [];
  for (const [note, content] of Object.entries(notes)) {
    const links = parseWikiLinks(content);
    links.forEach(link => {
      if (!notes[link]) {
        notes[link] = `# ${link}`;
        if (!noteOrder.includes(link)) {
          noteOrder.push(link);
        }
      }
      edgeData.push({ from: note, to: link });
    });
  }


  nodes = new vis.DataSet(nodeData);
  edges = new vis.DataSet(edgeData);

  const data = { nodes, edges };


  const options = {
    physics: false, // Turn off simulation forces
    interaction: {
      hover: true,
      dragNodes: true,  // Allow manual drag
      dragView: true,   // Allow pan
      zoomView: true
    },
    nodes: {
      shape: 'dot',
      size: 16,
      font: { color: '#d4d4d4' },
      color: {
        background: '#ADADAD',
        border: '#3a3a3a',
        highlight: { background: '#41DADC' }
      }
    },
    edges: {
      color: { color: '#888' },
      arrows: { to: { enabled: false } },
      smooth: false
    }
  };

  if (!network) {
    network = new vis.Network(graphContainer, data, options);

    network.on("click", function (params) {
      const nodeId = params.nodes[0];
      if (nodeId) openNote(nodeId);
    });

    network.on("dragEnd", function (params) {
      if (params.nodes.length) {
        const id = params.nodes[0];
        let position = network.getPositions([id])[id];

        if (snapToGrid) {
          const gridSize = 50;
          position.x = Math.round(position.x / gridSize) * gridSize;
          position.y = Math.round(position.y / gridSize) * gridSize;
          network.moveNode(id, position.x, position.y);
        }

        nodePositions[id] = position;
        localStorage.setItem('positions', JSON.stringify(nodePositions));
      }
    });

    network.on("hoverNode", function (params) {
      const nodeId = params.node;

      // Highlight the hovered node
      nodes.update({
        id: nodeId,
        color: {
          background: '#41DADC',
          border: '#41DADC'
        }
      });

      // Highlight connected nodes
      const connectedNodeIds = network.getConnectedNodes(nodeId);
      connectedNodeIds.forEach(id => {
        nodes.update({
          id,
          color: {
            background: '#88c0d0',
            border: '#88c0d0'
          }
        });
      });

      // Highlight connected edges
      const connectedEdgeIds = network.getConnectedEdges(nodeId);
      connectedEdgeIds.forEach(id => {
        edges.update({
          id,
          color: { color: '#41DADC' },
          width: 2
        });
      });
    });

    network.on("blurNode", function () {
      // Reset node colors
      nodes.get().forEach(n => {
        nodes.update({
          id: n.id,
          color: {
            background: n.id === currentNote ? '#41DADC' : '#ADADAD',
            border: '#3a3a3a'
          }
        });
      });

      // Reset edge colors
      edges.get().forEach(e => {
        edges.update({
          id: e.id,
          color: { color: '#888' },
          width: 1
        });
      });
    });


  } else {
    // Save current zoom and position
    const view = network.getViewPosition();
    const scale = network.getScale();

    // Update the graph data
    network.setData(data);

    // Restore previous view
    network.moveTo({
      position: view,
      scale: scale,
      animation: false
    });
  }


  renderNoteList();
}

function openNote(name) {
  if (!notes[name]) notes[name] = `# ${name}`;
  currentNote = name;
  editor.value = notes[name];
  updatePreviewAndGraph();
  renderNoteList();
}

function findFreePosition(existingPositions, spacing = 150) {
  const occupied = Object.values(existingPositions);
  let x = 0, y = 0;
  let attempts = 0;

  while (attempts < 1000) {
    const found = occupied.find(pos =>
      Math.hypot(pos.x - x, pos.y - y) < spacing
    );

    if (!found) return { x, y };

    // Try next spot (spiral/grid pattern)
    x += spacing;
    if (x > 1000) {
      x = 0;
      y += spacing;
    }

    attempts++;
  }

  // Fallback: just return something
  return { x: Math.random() * 1000, y: Math.random() * 1000 };
}


function createNewNote() {
  const baseName = "New Note";
  let i = 1;
  let name = baseName;

  while (notes[name] || noteOrder.includes(name)) {
    name = `${baseName} ${i++}`;
  }

  notes[name] = `# ${name}`;
  nodePositions[name] = findFreePosition(nodePositions);
  noteOrder.push(name); // ← Add to ordered list
  saveNotes();
  openNote(name);
}



function format(type) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.substring(start, end);
  let formatted = selected;

  switch (type) {
    case 'bold':
      formatted = `**${selected}**`;
      break;
    case 'italic':
      formatted = `*${selected}*`;
      break;
    case 'heading':
      formatted = `# ${selected}`;
      break;
    case 'code':
      if (selected.includes('\n')) {
        // Multi-line selection → insert fenced block
        formatted = `\`\`\`\n${selected}\n\`\`\``;
      } else {
        // Inline code
        formatted = `\`${selected}\``;
      }
      break;
  }

  editor.setRangeText(formatted, start, end, 'end');
  updatePreviewAndGraph();
}

editor.addEventListener('input', updatePreviewAndGraph);

openNote(currentNote);

function deleteCurrentNote() {
  if (currentNote === 'Home') {
    alert("You can't delete the Home note.");
    return;
  }

  if (confirm(`Delete "${currentNote}"? This cannot be undone.`)) {
    delete notes[currentNote];
    delete nodePositions[currentNote];

    noteOrder = noteOrder.filter(name => name !== currentNote);

    saveNotes();
    localStorage.setItem('positions', JSON.stringify(nodePositions));

    openNote('Home');
  }

}

function resetGraphView() {
  if (network) {
    const allNodeIds = network.body.data.nodes.getIds();
    const options = {
      nodes: allNodeIds,
      animation: {
        duration: 500,
        easingFunction: 'easeInOutQuad'
      }
    };
    network.fit(options);
  }
}

function renderNoteList() {
  const listEl = document.getElementById('note-list');
  listEl.innerHTML = '';
  noteOrder.forEach(note => {
    if (!notes[note]) return;

    const li = document.createElement('li');
    li.className = 'note-item';
    li.dataset.note = note;
    li.draggable = true;

    if (note === currentNote) li.classList.add('active');

    // Note label
    const label = document.createElement('span');
    label.textContent = note;
    label.style.flex = '1';
    label.addEventListener('click', () => openNote(note));

    // Inline renaming support
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'note-rename-input';
    input.value = note;
    input.style.display = 'none';

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        finishRename();
      } else if (e.key === 'Escape') {
        cancelRename();
      }
    });

    input.addEventListener('blur', cancelRename);

    function finishRename() {
      const newName = input.value.trim();
      if (!newName || newName === note || notes[newName]) return cancelRename();

      renameNote(note, newName);
    }


    function cancelRename() {
      input.style.display = 'none';
      label.style.display = '';
    }


    // 3-dot options
    const optionsBtn = document.createElement('button');
    optionsBtn.className = 'note-options';
    optionsBtn.innerHTML = '⋮';

    const menu = document.createElement('div');
    menu.className = 'note-menu';

    const renameBtn = document.createElement('button');
    renameBtn.textContent = 'Rename';
    if (note === currentNote) {
      window.activeNoteRenameInput = input;
      window.activeNoteLabel = label;
      window.activeNoteName = note;
    }
    renameBtn.onclick = () => {
      menu.style.display = 'none';
      label.style.display = 'none';
      input.style.display = '';
      input.focus();
      
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.onclick = () => {
      menu.style.display = 'none';
      currentNote = note;
      deleteCurrentNote();
    };

    menu.appendChild(renameBtn);
    menu.appendChild(deleteBtn);
    li.appendChild(label);
    li.appendChild(input);
    li.appendChild(optionsBtn);
    li.appendChild(menu);

    optionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.note-menu').forEach(m => m.style.display = 'none');
      menu.style.display = 'flex';
    });

    // Close menu if clicked outside
    document.addEventListener('click', () => {
      menu.style.display = 'none';
    });

    listEl.appendChild(li);
  });
}


function saveNotes() {
  localStorage.setItem('notes', JSON.stringify(notes));
  localStorage.setItem('noteOrder', JSON.stringify(noteOrder));
  localStorage.setItem('positions', JSON.stringify(nodePositions));
}

function renameNote(oldName, newName) {
  if (!newName || newName === oldName || notes[newName]) return;

  // Transfer content
  notes[newName] = notes[oldName];
  delete notes[oldName];

  // Update first heading to match new name
  notes[newName] = notes[newName].replace(/^#\s+.*$/m, `# ${newName}`);

  // Update node position
  if (nodePositions[oldName]) {
    nodePositions[newName] = nodePositions[oldName];
    delete nodePositions[oldName];
  }

  // Update order
  const index = noteOrder.indexOf(oldName);
  if (index !== -1) noteOrder[index] = newName;

  // Update current note
  const wasCurrent = currentNote === oldName;
  if (wasCurrent) {
    currentNote = newName;
    editor.value = notes[newName];
  }

  saveNotes();
  localStorage.setItem('positions', JSON.stringify(nodePositions));
  updatePreviewAndGraph();
  renderNoteList();
}

function updateSnapToggleIcon() {
  const snapButton = document.getElementById('snap-toggle');
  const iconName = snapToGrid ? 'unlock' : 'lock';

  // Replace inner HTML with new icon
  snapButton.innerHTML = `<i data-feather="${iconName}"></i>`;
  feather.replace();

  // Reattach click listener after replacing icon
  snapButton.onclick = () => {
    snapToGrid = !snapToGrid;
    snapButton.classList.toggle('active', snapToGrid);
    updateSnapToggleIcon(); // Recursively update icon + listener
  };
}



document.addEventListener('keydown', (e) => {
  // Only act if the Delete key was pressed
  if (e.key === 'Delete') {
    // Optional: avoid deleting while typing in editor
    if (document.activeElement === editor) return;

    // Call your existing delete logic
    deleteCurrentNote();
  }

  if (e.key === 'F2') {
    if (window.activeNoteRenameInput && window.activeNoteLabel) {
      window.activeNoteLabel.style.display = 'none';
      window.activeNoteRenameInput.style.display = '';
      window.activeNoteRenameInput.focus();
      window.activeNoteRenameInput.select();
    }
  }

});



updateSnapToggleIcon();
feather.replace();