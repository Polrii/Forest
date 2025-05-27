const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const noteList = document.getElementById('note-list');
const graphContainer = document.getElementById('graph');
const snapButton = document.getElementById('snap-toggle');
const snapIcon = document.getElementById('snap-icon');

let notes = JSON.parse(localStorage.getItem('notes')) || {};
let nodes, edges;

let currentNote = 'Home';
let noteOrder = JSON.parse(localStorage.getItem('noteOrder')) || Object.keys(notes);

let previousLinks = new Set();

if (!notes['Home']) {
  notes['Home'] = '# Home';
  if (!noteOrder.includes('Home')) noteOrder.push('Home');
    saveNotes();
}

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
  let html = marked.parse(content);

  // Replace [[Link]] with clickable links in the preview pane
  html = html.replace(/\[\[([^\]\[]+)\]\]/g, (match, linkName) => {
    return `<a href="#" class="wikilink" data-link="${linkName}">${linkName}</a>`;
  });

  preview.innerHTML = html;

  notes[currentNote] = content;

  const currentLinks = new Set(parseWikiLinks(content));
  const existingNotes = Object.keys(notes);
  const createdThisPass = new Set();

  // Handle link additions or renames
  currentLinks.forEach(link => {
    if (!notes[link]) {
      // Find longest previous match
      const candidates = [...existingNotes].filter(name =>
        link.startsWith(name) &&
        !currentLinks.has(name) &&
        !createdThisPass.has(name)
      );

      if (candidates.length) {
        // Rename longest previous
        const oldName = candidates.sort((a, b) => b.length - a.length)[0];
        let content = notes[oldName];

        // Replace the first heading if it's "# OldName"
        content = content.replace(/^#\s+.*$/m, `# ${link}`);
        notes[link] = content;

        delete notes[oldName];

        const idx = noteOrder.indexOf(oldName);
        if (idx !== -1) noteOrder[idx] = link;
      } else {
        notes[link] = `# ${link}`;
        noteOrder.push(link);
      }

      createdThisPass.add(link);
    }
  });

  // Handle link deletions: remove old links no longer used
  previousLinks.forEach(oldLink => {
    if (!currentLinks.has(oldLink) && Object.keys(notes).includes(oldLink)) {
      // Only delete if this link isn't used in any note
      const usedElsewhere = Object.entries(notes).some(([name, noteText]) =>
        parseWikiLinks(noteText).includes(oldLink)
      );

      if (!usedElsewhere && oldLink !== 'Home') {
        delete notes[oldLink];
        const idx = noteOrder.indexOf(oldLink);
        if (idx !== -1) noteOrder.splice(idx, 1);
      }
    }
  });

  previousLinks = currentLinks;

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

    setTimeout(() => {
      if (snapToGrid) drawGridOverlay(true);
    }, 50);  // Delay just long enough for graph to render


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

    network.on("zoom", () => {
      if (snapToGrid) drawGridOverlay(true);
    });

    network.on("dragging", () => {
      if (snapToGrid) drawGridOverlay(true);
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
      formatted = `\`\`\`\n${selected}\n\`\`\``;
      break;
    case 'list':
      if (start === end) {
        // No selection: insert "- " and place cursor after it
        const bullet = '- ';
        editor.setRangeText(bullet, start, end, 'end');

        // Move the cursor to just after the bullet
        const newPos = start + bullet.length;
        setTimeout(() => {
          editor.setSelectionRange(newPos, newPos);
          editor.focus();
        }, 0); // Delay ensures the text is inserted first
      } else {
        // Selection: prefix each line with "- "
        const selectedText = editor.value.substring(start, end);
        const lines = selectedText.split('\n');
        const bulleted = lines.map(line => (line.trim() ? `- ${line}` : '')).join('\n');

        editor.setRangeText(bulleted, start, end, 'end');
        const newPos = start + bulleted.length;

        setTimeout(() => {
          editor.setSelectionRange(newPos, newPos);
          editor.focus();
        }, 0);
      }
      break;
    case 'link':
      const linkStart = '[[', linkEnd = ']]';

      if (start === end) {
        // No selection — insert empty link with cursor between brackets
        editor.setRangeText(`${linkStart}${linkEnd}`, start, end, 'end');
        const newPos = start + linkStart.length;
        setTimeout(() => {
          editor.setSelectionRange(newPos, newPos);
          editor.focus();
        }, 0);
      } else {
        // Wrap selected text in brackets
        const selectedText = editor.value.substring(start, end);
        const linkedText = `${linkStart}${selectedText}${linkEnd}`;
        editor.setRangeText(linkedText, start, end, 'end');

        const newPos = start + linkedText.length;
        setTimeout(() => {
          editor.setSelectionRange(newPos, newPos);
          editor.focus();
        }, 0);
      }
      break;

    }


  editor.setRangeText(formatted, start, end, 'end');
  updatePreviewAndGraph();
}

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

    // Redraw grid shortly after animation ends
    if (snapToGrid) {
      setTimeout(() => {
        drawGridOverlay(true);
      }, 550); // Slightly longer than animation
    }
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
    drawGridOverlay(snapToGrid);
    updateSnapToggleIcon(); // Recursively update icon + listener
  };
}

function drawGridOverlay(enabled) {
  const canvas = document.getElementById('grid-overlay');
  const ctx = canvas.getContext('2d');
  const gridSize = 50;

  const rect = document.getElementById('graph').getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!enabled || !network) return;

  const scale = network.getScale();
  const offset = network.getViewPosition(); // in world coordinates

  // Convert DOM origin to world coordinate
  const topLeft = network.DOMtoCanvas({ x: 0, y: 0 });
  const bottomRight = network.DOMtoCanvas({ x: canvas.width, y: canvas.height });

  // Snap starting X/Y to nearest grid line in world space
  const startX = Math.floor(topLeft.x / gridSize) * gridSize;
  const endX = Math.ceil(bottomRight.x / gridSize) * gridSize;
  const startY = Math.floor(topLeft.y / gridSize) * gridSize;
  const endY = Math.ceil(bottomRight.y / gridSize) * gridSize;

  ctx.strokeStyle = '#999';
  ctx.lineWidth = 0.5;

  // Vertical lines
  for (let x = startX; x <= endX; x += gridSize) {
    const domX = network.canvasToDOM({ x, y: 0 }).x;
    ctx.beginPath();
    ctx.moveTo(domX, 0);
    ctx.lineTo(domX, canvas.height);
    ctx.stroke();
  }

  // Horizontal lines
  for (let y = startY; y <= endY; y += gridSize) {
    const domY = network.canvasToDOM({ x: 0, y }).y;
    ctx.beginPath();
    ctx.moveTo(0, domY);
    ctx.lineTo(canvas.width, domY);
    ctx.stroke();
  }
}


openNote(currentNote);


editor.addEventListener('input', updatePreviewAndGraph);

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

window.addEventListener('resize', () => {
  if (snapToGrid) drawGridOverlay(true);
});

editor.addEventListener('keydown', function (e) {
  const cursorPos = editor.selectionStart;

  // ENTER: auto-bullet or exit list
  if (e.key === 'Enter') {
    const lines = editor.value.slice(0, cursorPos).split('\n');
    const currentLine = lines[lines.length - 1];
    const listMatch = currentLine.match(/^(\s*[-*+] )/);

    if (listMatch) {
      const bullet = listMatch[1];
      const lineStart = editor.value.lastIndexOf('\n', cursorPos - 1) + 1;
      const lineText = editor.value.slice(lineStart, cursorPos).trim();

      e.preventDefault();

      if (lineText === bullet.trim()) {
        // Exit list if current bullet is empty
        editor.setSelectionRange(lineStart, cursorPos);
        editor.setRangeText('', lineStart, cursorPos, 'start');
      } else {
        // Continue list
        editor.setRangeText('\n' + bullet, cursorPos, cursorPos, 'end');
      }

      updatePreviewAndGraph();
    }
  }

  // TAB and SHIFT+TAB: indent and unindent
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;

    const lineStart = editor.value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = editor.value.indexOf('\n', start);
    const fullLineEnd = lineEnd === -1 ? editor.value.length : lineEnd;
    const line = editor.value.slice(lineStart, fullLineEnd);

    let modifiedLine = line;
    let newCursorPos = start;

    if (e.shiftKey) {
      // SHIFT+TAB: Unindent if at least 2 spaces
      if (line.startsWith('  ')) {
        modifiedLine = line.slice(2);
        editor.setRangeText(modifiedLine, lineStart, fullLineEnd, 'start');
        newCursorPos = start - 2;
      }
    } else {
      // TAB: Indent
      modifiedLine = '  ' + line;
      editor.setRangeText(modifiedLine, lineStart, fullLineEnd, 'start');
      newCursorPos = start + 2;
    }

    // Move the cursor to its new logical position
    editor.selectionStart = editor.selectionEnd = newCursorPos;
    updatePreviewAndGraph();
  }

  if (e.key === 'Backspace') {
    const pos = editor.selectionStart;
    const before = editor.value.slice(0, pos);
    const after = editor.value.slice(pos);

    // Check if the last two characters are '[['
    if (before.endsWith('[[') && after.startsWith(']]')) {
      e.preventDefault();

      // Remove both [[ and ]] (total of 4 characters)
      const newBefore = before.slice(0, -2);
      const newAfter = after.slice(2);
      editor.value = newBefore + newAfter;

      const newPos = newBefore.length;
      editor.setSelectionRange(newPos, newPos);
      updatePreviewAndGraph();
    }
  }


});

editor.addEventListener('keydown', function (e) {
  const pos = editor.selectionStart;

  if (e.key === '[') {
    const prevChar = editor.value.charAt(pos - 1);

    if (prevChar === '[') {
      // Detected typing of `[[`
      e.preventDefault();
      editor.setRangeText('[]]', pos, pos, 'end');

      // Move cursor between the brackets
      editor.setSelectionRange(pos + 1, pos + 1);
      updatePreviewAndGraph();
    }
  }

  // Keep your other key handlers: Enter, Tab, Shift+Tab, etc.
});

preview.addEventListener('click', function (e) {
  if (e.target.classList.contains('wikilink')) {
    const name = e.target.dataset.link;
    openNote(name);
    e.preventDefault();
  }
});



updateSnapToggleIcon();
feather.replace();