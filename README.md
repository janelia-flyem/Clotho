![Picture](images/clotho-logo.png)

##Description
Clotho is a Javascript library that that allows users to explore, visualize, and manipulate graph data. It is supported by D3.js (http://d3js.org/) and DagreD3 (https://github.com/cpettitt/dagre-d3).

##Example
http://janelia-flyem.github.io/Clotho/force.html
http://janelia-flyem.github.io/Clotho/dag.html

##Quick Start
1) Clone the repository
2) Open examples/dag.html or examples/force.html in a modern browser.

##Functions

FORCE DIRECTED GRAPH OPTIONS

init - initializes the graph. this is the only function that needs to be called to create the graph.

addNode/deleteNode - add and delete node by name

addEdge/deleteEdge - add and delete edge by source and target

pinAllNodes/releaseAllNodes - pins or release nodes from the force

showAllEdgeText/hideAllEdgeText - show or hide edge labels

DAG OPTIONS

fitDAG - Fits entire DAG to SVG Container

toggleChildren - toggles collapsing and expanding of a parent node

collapseGraph - fully collapses entire DAG

expandGraph - fully expands entire DAG

##Author Information
Clotho was created by members of Women's Coding Circle at Janelia Research Campus (http://womenscodingcircle.com/) and developed by Jenny Xing (xingy@mail.hhmi.org).

[![Picture](images/hhmi_janelia_transparentbkgrnd.png)](http://www.janelia.org)

[Scientific Computing](http://www.janelia.org/research-resources/computing-resources)  
[Janelia Farm Research Campus](http://www.janelia.org)  
[Howard Hughes Medical Institute](http://www.hhmi.org)
