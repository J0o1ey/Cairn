<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import klay from 'cytoscape-klay';
import elk from 'cytoscape-elk';
import { useProjectsStore } from '@/stores/projects';
import { usePrefsStore } from '@/stores/prefs';
import {
  isBootstrapIntent,
  openIntentNodeLabel,
  openIntentNodeSize,
  openIntentNodeType,
  summarizeFactLabel,
} from '@/utils/intent';
import { factNodeSize } from '@/utils/measure';

cytoscape.use(dagre);
cytoscape.use(klay);
cytoscape.use(elk);

interface NodeMeta {
  id: string;
  label: string;
  description: string;
  nodeType: string;
  intentId?: string;
  width: number;
  height: number;
}

interface EdgeMeta {
  id: string;
  source: string;
  target: string;
  intentId: string;
  label: string;
  status: string;
  edgeType?: string;
}

const projects = useProjectsStore();
const prefs = usePrefsStore();
const containerRef = ref<HTMLDivElement | null>(null);
let cy: Core | null = null;

function buildElements(): { nodes: ElementDefinition[]; edges: ElementDefinition[] } {
  const nodes: ElementDefinition[] = [];
  const edges: ElementDefinition[] = [];
  const project = projects.project;
  if (!project) return { nodes, edges };
  for (const f of project.facts) {
    const nodeType = f.id === 'origin' ? 'origin' : f.id === 'goal' ? 'goal' : 'fact';
    const label = summarizeFactLabel(f);
    const kind = nodeType === 'fact' ? 'fact' : 'pillar';
    const size = factNodeSize(label, kind);
    nodes.push({
      data: {
        id: f.id,
        label,
        description: f.description,
        nodeType,
        width: size.width,
        height: size.height,
      } as NodeMeta,
    });
  }
  for (const intent of project.intents) {
    const lbl = intent.description;
    if (intent.to) {
      for (const src of intent.from) {
        edges.push({
          data: {
            id: `${intent.id}_${src}`,
            source: src,
            target: intent.to,
            intentId: intent.id,
            label: lbl,
            status: 'concluded',
          } as EdgeMeta,
        });
      }
    } else {
      const phId = `_ph_${intent.id}`;
      const sz = openIntentNodeSize(intent);
      const nt = openIntentNodeType(intent);
      nodes.push({
        data: {
          id: phId,
          label: openIntentNodeLabel(intent),
          description: intent.description,
          nodeType: nt,
          intentId: intent.id,
          width: sz.width,
          height: sz.height,
        } as NodeMeta,
      });
      for (const src of intent.from) {
        edges.push({
          data: {
            id: `${intent.id}_${src}`,
            source: src,
            target: phId,
            intentId: intent.id,
            label: lbl,
            status: nt,
          } as EdgeMeta,
        });
      }
      if (isBootstrapIntent(intent)) {
        edges.push({
          data: {
            id: `${intent.id}_goal`,
            source: phId,
            target: 'goal',
            intentId: intent.id,
            label: '',
            status: nt,
            edgeType: 'bootstrap_scope',
          } as EdgeMeta,
        });
      }
    }
  }
  return { nodes, edges };
}


// 由于 @types/cytoscape 对 css 字段的字符串字面量过于严格，这里使用宽松类型，
// 由 cytoscape 在运行时校验属性合法性。
type StyleEntry = { selector: string; style: Record<string, unknown> };

function graphStyles(): StyleEntry[] {
  const common: Record<string, unknown> = {
    'text-valign': 'center',
    'text-halign': 'center',
    'font-family': '-apple-system,BlinkMacSystemFont,Inter,sans-serif',
  };
  return [
    { selector: 'node[nodeType="origin"]', style: { ...common, shape: 'round-rectangle', 'background-color': '#14b8a6', label: 'data(label)', color: '#fff', 'font-size': '11px', 'font-weight': 'bold', 'text-wrap': 'wrap', 'text-max-width': '92px', width: 'data(width)', height: 'data(height)', 'border-width': 0 } },
    { selector: 'node[nodeType="goal"]', style: { ...common, shape: 'round-rectangle', 'background-color': '#f43f5e', label: 'data(label)', color: '#fff', 'font-size': '11px', 'font-weight': 'bold', 'text-wrap': 'wrap', 'text-max-width': '92px', width: 'data(width)', height: 'data(height)', 'border-width': 0 } },
    { selector: 'node[nodeType="fact"]', style: { ...common, shape: 'round-rectangle', 'background-color': '#6366f1', label: 'data(label)', color: '#fff', 'font-size': '10px', 'font-weight': 'bold', 'text-wrap': 'wrap', 'text-max-width': '116px', width: 'data(width)', height: 'data(height)', 'border-width': 0 } },
    { selector: 'node[nodeType="in_progress"]', style: { ...common, shape: 'ellipse', 'background-color': '#f59e0b', 'background-opacity': 0.8, label: '?', color: '#fff', 'font-size': '11px', 'font-weight': 'bold', width: 22, height: 22, 'border-width': 2, 'border-color': '#d97706' } },
    { selector: 'node[nodeType="unclaimed"]', style: { ...common, shape: 'ellipse', 'background-color': '#cbd5e1', 'background-opacity': 0.5, label: '?', color: '#94a3b8', 'font-size': '11px', 'font-weight': 'bold', width: 20, height: 20, 'border-width': 1.5, 'border-color': '#94a3b8', 'border-style': 'dashed' } },
    { selector: 'node[nodeType="bootstrap_pending"]', style: { ...common, shape: 'round-rectangle', 'background-color': '#fff7ed', 'background-opacity': 0.96, label: 'data(label)', color: '#c2410c', 'font-size': '10px', 'font-weight': 'bold', width: 'data(width)', height: 'data(height)', 'border-width': 1.5, 'border-color': '#fdba74', 'border-style': 'dashed', 'text-wrap': 'wrap', 'text-max-width': '70px' } },
    { selector: 'node[nodeType="bootstrap_running"]', style: { ...common, shape: 'round-rectangle', 'background-color': '#fb923c', 'background-opacity': 0.96, label: 'data(label)', color: '#fff7ed', 'font-size': '10px', 'font-weight': 'bold', width: 'data(width)', height: 'data(height)', 'border-width': 2, 'border-color': '#ea580c', 'text-wrap': 'wrap', 'text-max-width': '70px' } },

    { selector: 'edge[status="concluded"]', style: { width: 2, 'line-color': '#6ee7b7', 'target-arrow-color': '#6ee7b7', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)', 'font-size': '7px', color: '#94a3b8', 'text-rotation': 'autorotate', 'text-margin-y': -9, 'text-max-width': '80px', 'text-wrap': 'ellipsis', 'text-background-color': '#f8fafc', 'text-background-opacity': 0.85, 'text-background-padding': '2px', 'arrow-scale': 0.9 } },
    { selector: 'edge[status="in_progress"]', style: { width: 2, 'line-color': '#fbbf24', 'line-style': 'dashed', 'target-arrow-color': '#fbbf24', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)', 'font-size': '7px', color: '#b45309', 'text-rotation': 'autorotate', 'text-margin-y': -9, 'text-max-width': '80px', 'text-wrap': 'ellipsis', 'text-background-color': '#fffbeb', 'text-background-opacity': 0.85, 'text-background-padding': '2px', 'arrow-scale': 0.9 } },
    { selector: 'edge[status="unclaimed"]', style: { width: 1.5, 'line-color': '#cbd5e1', 'line-style': 'dashed', 'target-arrow-color': '#cbd5e1', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)', 'font-size': '7px', color: '#94a3b8', 'text-rotation': 'autorotate', 'text-margin-y': -9, 'text-max-width': '80px', 'text-wrap': 'ellipsis', 'text-background-color': '#f8fafc', 'text-background-opacity': 0.85, 'text-background-padding': '2px', 'arrow-scale': 0.7 } },
    { selector: 'edge[status="bootstrap_pending"]', style: { width: 2, 'line-color': '#fdba74', 'line-style': 'dashed', 'target-arrow-color': '#fdba74', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)', 'font-size': '7px', color: '#c2410c', 'text-rotation': 'autorotate', 'text-margin-y': -9, 'text-max-width': '88px', 'text-wrap': 'ellipsis', 'text-background-color': '#fff7ed', 'text-background-opacity': 0.92, 'text-background-padding': '2px', 'arrow-scale': 0.85 } },
    { selector: 'edge[status="bootstrap_running"]', style: { width: 2.5, 'line-color': '#fb923c', 'line-style': 'dashed', 'target-arrow-color': '#fb923c', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)', 'font-size': '7px', color: '#c2410c', 'text-rotation': 'autorotate', 'text-margin-y': -9, 'text-max-width': '88px', 'text-wrap': 'ellipsis', 'text-background-color': '#fff7ed', 'text-background-opacity': 0.92, 'text-background-padding': '2px', 'arrow-scale': 0.95 } },
    { selector: 'edge[edgeType="bootstrap_scope"]', style: { label: '', width: 1.8, 'curve-style': 'bezier', 'line-style': 'dotted', 'target-arrow-shape': 'triangle-backcurve', 'arrow-scale': 0.75 } },

    { selector: 'node.focus', style: { 'border-width': 3, 'border-color': '#312e81', 'border-opacity': 0.95, 'z-index': 1000 } },
    { selector: 'edge.focus', style: { 'z-index': 1000, 'overlay-color': '#93c5fd', 'overlay-opacity': 0.22, 'overlay-padding': 5 } },
    { selector: 'node.selected-fact', style: { 'border-width': 0, 'underlay-color': '#93c5fd', 'underlay-padding': 8, 'underlay-opacity': 0.28, 'z-index': 1001 } },
  ];
}

function layoutOpts(animate = true): cytoscape.LayoutOptions {
  const direction = prefs.layoutDirection;
  if (prefs.layoutEngine === 'elk') {
    const elkDirection = direction === 'TB' ? 'DOWN' : 'RIGHT';
    return {
      name: 'elk',
      fit: true,
      padding: 50,
      animate,
      animationDuration: 350,
      animationEasing: 'ease-in-out-cubic',
      elk: {
        algorithm: 'layered',
        'elk.direction': elkDirection,
        'elk.spacing.nodeNode': '50',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      },
    } as unknown as cytoscape.LayoutOptions;
  }
  if (prefs.layoutEngine === 'klay') {
    return {
      name: 'klay',
      fit: true,
      padding: 50,
      animate,
      animationDuration: 400,
      animationEasing: 'ease-in-out-cubic',
      klay: {
        direction: direction === 'TB' ? 'DOWN' : 'RIGHT',
        edgeRouting: 'POLYLINE',
        crossingMinimization: 'LAYER_SWEEP',
        nodeLayering: 'NETWORK_SIMPLEX',
        nodePlacement: 'BRANDES_KOEPF',
        spacing: 44,
        thoroughness: 8,
      },
    } as unknown as cytoscape.LayoutOptions;
  }
  return {
    name: 'dagre',
    rankDir: direction,
    nodeSep: 60,
    rankSep: 80,
    padding: 50,
    fit: true,
    animate,
    animationDuration: 400,
    animationEasing: 'ease-in-out-cubic',
  } as unknown as cytoscape.LayoutOptions;
}

function applyDecorations() {
  if (!cy) return;
  cy.elements().removeClass('focus selected-fact');
  const selected = projects.selectedNode;
  const facts = projects.selectedFacts;
  if (selected?.type === 'fact') {
    facts.forEach(id => {
      const el = cy?.getElementById(id);
      if (el && el.length) el.addClass('selected-fact focus');
    });
  } else if (selected?.type === 'intent') {
    const phId = `_ph_${selected.id}`;
    const phNode = cy.getElementById(phId);
    if (phNode && phNode.length) phNode.addClass('focus');
    cy.edges(`[intentId="${selected.id}"]`).addClass('focus');
  }
}

function init() {
  if (!containerRef.value) return;
  const { nodes, edges } = buildElements();
  cy = cytoscape({
    container: containerRef.value,
    elements: [...nodes, ...edges],
    style: graphStyles() as unknown as cytoscape.StylesheetJson,
    layout: layoutOpts(false),
    minZoom: 0.15,
    maxZoom: 3.5,
  });
  cy.on('tap', 'node', evt => {
    const data = evt.target.data() as NodeMeta;
    if (data.intentId && data.id.startsWith('_ph_')) {
      projects.selectIntent(data.intentId);
      return;
    }
    if (evt.originalEvent?.shiftKey && data.nodeType !== 'origin' && data.nodeType !== 'goal' && !data.intentId) {
      projects.toggleSelectFact(data.id);
    } else if (!data.intentId) {
      projects.selectFact(data.id);
    }
  });
  cy.on('tap', 'edge', evt => {
    const intentId = evt.target.data('intentId');
    if (intentId) projects.selectIntent(String(intentId));
  });
  cy.on('tap', evt => {
    if (evt.target === cy) projects.clearSelection();
  });
  applyDecorations();
}

function rebuild() {
  if (!cy || !projects.project) return;
  const { nodes, edges } = buildElements();
  const wantNodes = new Set(nodes.map(n => (n.data as NodeMeta).id));
  const wantEdges = new Set(edges.map(e => (e.data as EdgeMeta).id));

  let changed = false;
  cy.nodes().forEach(n => {
    if (!wantNodes.has(n.id())) {
      n.remove();
      changed = true;
    }
  });
  cy.edges().forEach(e => {
    if (!wantEdges.has(e.id())) {
      e.remove();
      changed = true;
    }
  });
  for (const n of nodes) {
    const data = n.data as NodeMeta;
    const ex = cy.getElementById(data.id);
    if (ex.length === 0) {
      cy.add(n);
      changed = true;
    } else {
      const old = ex.data() as NodeMeta;
      if (
        old.nodeType !== data.nodeType ||
        old.label !== data.label ||
        old.description !== data.description ||
        old.width !== data.width ||
        old.height !== data.height
      ) {
        ex.data(data);
        changed = true;
      }
    }
  }
  for (const e of edges) {
    const data = e.data as EdgeMeta;
    const ex = cy.getElementById(data.id);
    if (ex.length === 0) {
      cy.add(e);
      changed = true;
    } else if ((ex.data() as EdgeMeta).status !== data.status) {
      ex.data(data);
      changed = true;
    }
  }
  if (changed) cy.layout(layoutOpts(true)).run();
  applyDecorations();
}

function fit() {
  cy?.fit(undefined, 50);
}
function applyLayout() {
  cy?.layout(layoutOpts(true)).run();
}

watch(
  () => projects.project,
  () => rebuild(),
  { deep: true },
);
watch(
  () => projects.selectedNode,
  () => applyDecorations(),
);
watch(
  () => projects.selectedFacts,
  () => applyDecorations(),
  { deep: true },
);
watch(
  () => prefs.layoutMode,
  () => applyLayout(),
);

defineExpose({ fit, applyLayout });

let resizeObserver: ResizeObserver | null = null;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;

function setupAutoFit() {
  if (!containerRef.value || resizeObserver) return;
  resizeObserver = new ResizeObserver(() => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (cy) {
        cy.resize();
        cy.fit(undefined, 50);
      }
    }, 200);
  });
  resizeObserver.observe(containerRef.value);
}

function teardownAutoFit() {
  if (resizeTimer) {
    clearTimeout(resizeTimer);
    resizeTimer = null;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
}

onMounted(() => {
  init();
  setupAutoFit();
});
onBeforeUnmount(() => {
  teardownAutoFit();
  if (cy) {
    cy.destroy();
    cy = null;
  }
});
</script>

<template>
  <div ref="containerRef" id="cy" class="relative z-0 flex-1 h-full"></div>
</template>
