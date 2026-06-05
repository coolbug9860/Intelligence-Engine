import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { ReportSuggestion } from '../types';

interface NexusGraphProps {
  suggestions: ReportSuggestion[];
  onNodeClick: (suggestion: ReportSuggestion) => void;
}

interface Node extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: 'suggestion' | 'cluster';
  val: number;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
}

export const NexusGraph: React.FC<NexusGraphProps> = ({ suggestions, onNodeClick }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || suggestions.length === 0) return;

    const width = 800;
    const height = 600;

    const nodes: Node[] = [];
    const links: Link[] = [];

    const clusters = Array.from(new Set(suggestions.map(s => s.thematicCluster))) as string[];
    
    // Add cluster nodes
    clusters.forEach(c => {
      nodes.push({ id: `cluster-${c}`, label: c, type: 'cluster', val: 20 });
    });

    // Add suggestion nodes and links
    suggestions.forEach(s => {
      nodes.push({ id: s.id, label: s.reportTitle, type: 'suggestion', val: 10 + (s.confidenceScore * 2) });
      links.push({ 
        source: s.id, 
        target: `cluster-${s.thematicCluster}` 
      });
    });

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const simulation = d3.forceSimulation<Node>(nodes)
      .force('link', d3.forceLink<Node, Link>(links).id(d => (d as Node).id).distance(100))
      .force('charge', d3.forceManyBody().strength(-150))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<Node>().radius(d => d.val + 5));

    const g = svg.append('g');

    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', 1);

    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .on('click', (event, d) => {
        if (d.type === 'suggestion') {
          const s = suggestions.find(s => s.id === d.id);
          if (s) onNodeClick(s);
        }
      })
      .call(d3.drag<SVGGElement, Node>()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended) as any);

    node.append('circle')
      .attr('r', d => d.val)
      .attr('fill', d => d.type === 'cluster' ? '#1A3668' : '#D62828')
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .attr('shadow', '0 4px 6px rgba(0,0,0,0.1)');

    node.append('text')
      .text(d => d.label.length > 20 ? d.label.substring(0, 17) + '...' : d.label)
      .attr('x', d => d.val + 5)
      .attr('y', 4)
      .attr('font-size', d => d.type === 'cluster' ? '10px' : '8px')
      .attr('font-weight', 'bold')
      .attr('fill', '#1a1a1a')
      .attr('pointer-events', 'none');

    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as Node).x!)
        .attr('y1', d => (d.source as Node).y!)
        .attr('x2', d => (d.target as Node).x!)
        .attr('y2', d => (d.target as Node).y!);

      node
        .attr('transform', d => `translate(${d.x},${d.y})`);
    });

    function dragstarted(event: any, d: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event: any, d: any) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event: any, d: any) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    // Zoom
    svg.call(d3.zoom<SVGSVGElement, unknown>()
      .extent([[0, 0], [width, height]])
      .scaleExtent([0.5, 5])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      }));

  }, [suggestions]);

  return (
    <div className="w-full h-full bg-slate-50 relative overflow-hidden flex items-center justify-center">
      <div className="absolute top-4 left-4 z-10 space-y-1">
        <h3 className="text-[10px] font-black text-navy uppercase tracking-widest">Nexus Network Intelligence</h3>
        <p className="text-[8px] font-bold text-muted uppercase">Visualizing asymmetric causal clusters</p>
      </div>
      <div className="absolute bottom-4 right-4 z-10 flex gap-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-navy"></div>
          <span className="text-[8px] font-bold uppercase text-muted tracking-tight">Thematic Cluster</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-brand-red"></div>
          <span className="text-[8px] font-bold uppercase text-muted tracking-tight">Research Opp</span>
        </div>
      </div>
      <svg ref={svgRef} className="w-full h-full" viewBox="0 0 800 600"></svg>
    </div>
  );
};
