var clotho = function (parameters) {
    var defaults = {
        layout: '', //can only be dag or force
        graphData: {},
        svgContainerID: '',
        width: 500,
        height: 500,
        nodeRadius: 15,
    };

    var conf = $.extend({}, parameters);
    var cfg = $.extend(true, {}, defaults, conf);
    var self = this;
    //initialize global variables
    var zoom, force, nodeDrag;
    var dag;
    var svg, svgBackground, elementHolderLayer;
    var width, height;
    var nodeLayer, edgeLayer;
    var nodeData, edgeData;
    var shadow, defaultNodeRadius;
    var hiddenNeurons, numNodes;
    var isForce = cfg.layout == "force";
    var isDag = cfg.layout == "dag";

    //initializes the graph, keydown, and zoom functionalities
    this.init = function () {
        width = cfg.width;
        height = cfg.height;
        svg = d3.select('#' + cfg.svgContainerID)
            .append("svg")
            .attr("id", function () {
            if (isForce) {
                return "Circuit Diagram";
            }
            if (isDag) {
                return "DVID DAG";
            }
        })
            .attr("width", width)
            .attr("height", height);

        svgBackground = svg.append("rect")
            .attr("id", "svgBackground")
            .attr("fill", "transparent")
            .attr("width", width)
            .attr("height", height)
            .on("focus", function () {
            if (self.elementOfInterest) {
                $(self.elementOfInterest).css("filter", "");
            }
            self.elementOfInterest = null;
            $(this).trigger('svgBackgroundFocus');
        });
        elementHolderLayer = svg.append("g")
            .attr("id", "elementHolderLayer");

        zoom = d3.behavior.zoom().on("zoom", function () {
            elementHolderLayer.attr("transform", "translate(" + d3.event.translate + ")" +
                "scale(" + d3.event.scale + ")");
        });
        svgBackground.call(zoom);

        shadow = svg.append("defs")
            .append("filter")
            .attr("id", "drop-shadow")
            .attr('x', "-40%")
            .attr('y', "-40%")
            .attr('height', "200%")
            .attr('width', "200%");
        shadow.append("feOffset")
            .attr('result', "offOut")
            .attr('in', "SourceAlpha")
            .attr('dx', "0")
            .attr('dy', "0");
        shadow.append("feGaussianBlur")
            .attr('result', "blurOut")
            .attr('in', "offOut")
            .attr('stdDeviation', "8");
        shadow.append("feBlend")
            .attr('in', "SourceGraphic")
            .attr('in2', "blurOut")
            .attr('mode', "normal");

        if (isForce) {
            //only force layout needs these SVG groups. dagre takes care of the groups for dags.
            nodeLayer = elementHolderLayer.append("g").attr("class", "nodes");
            edgeLayer = elementHolderLayer.append("g").attr("class", "edges");
            initForce();
        }
        if (isDag) {
            initDag();
        }
    };

    function initForce() {
        defaultNodeRadius = cfg.nodeRadius;
        numNodes = 0;
        hiddenNeurons = {
            'nodes': [],
            'edges': []
        };
        force = d3.layout.force()
            .size([width, height])
            .linkDistance(defaultNodeRadius * 8);
        nodeDrag = d3.behavior.drag()
            .on("dragstart", function (d) {
            d.fixed = true;
        })
            .on("drag", drag)
            .on("dragend", function (d) {
            d.fixed = true;
            force.resume();
        });
        nodeData = force.nodes();
        edgeData = force.links();
        _.each(cfg.graphData.d3NodeData, function (node) {
            self.addNode(node);
        });
        _.each(cfg.graphData.d3EdgeData, function (edge) {
            self.addEdge(edge.source, edge.target, edge.weight);
        });
        d3.select(document).on("keydown", keydown);
    }

    function initDag() {
        dag = new dagreD3.graphlib.Graph({
            compound: true,
            multigraph: true
        })
            .setGraph({})
            .setDefaultEdgeLabel(function () {
            return {};
        });

        //adds nodes and edges from JSON
        $.each(cfg.graphData, function (index, n) {
            dag.setNode(n.versionID, {
                label: n.versionID + ': ' + n.uuid.substr(0, 5),
                class: n.class,
                rx: 5,
                ry: 5,
                id: "node" + n.versionID,
                expandedChildren: null,
                collapsedChildren: null,
                isMerge: false,
                isCollapsible: true
            });
            $.each(n.children, function (c) {
                dag.setEdge(n.versionID, n.children[c], {
                    lineInterpolate: 'basis',
                    id: n.versionID + "-" + n.children[c]
                });
            });
        });

        dag.graph().transition = function (selection) {
            return selection.transition().duration(300);
        };

        //returns a list of all predecessors of a parent node
        function findAllPredecessors(node, predecessorsList) {
            predecessorsList = predecessorsList || [];
            dag.predecessors(node).forEach(function (n) {
                //some nodes can be visited more than once so this removes them
                if (predecessorsList.indexOf(n) == -1) {
                    predecessorsList.push(n);
                }
                findAllPredecessors(n, predecessorsList);
            });
            return predecessorsList;
        }

        //sets merges and all their predecessors to be uncollapsible
        //gives merges a "merge" class
        dag.nodes().forEach(function (n) {
            if (dag.predecessors(n).length > 1) {
                dag.node(n).isMerge = true;
                dag.node(n).class = dag.node(n).class + " " + "merge";
                dag.node(n).isCollapsible = false;
                findAllPredecessors(n).forEach(function (p) {
                    dag.node(p).isCollapsible = false;
                });
            }
        });

        //gives parents a variable to access their collapsible children
        dag.nodes().forEach(function (n) {
            //collapsibleChildren will be a dictionary with key being the node name (that you can call dag.node() with) and the value being properties of that node
            var collapsibleChildren = {};
            dag.successors(n).forEach(function (c) {
                if (dag.node(c).isCollapsible) {
                    //adds the node properties to collapsibleChildren so that it can be used to add the node back later
                    collapsibleChildren[c] = dag.node(c);
                }
            });
            // only give it expandedChildren if it has collapsible children. otherwise it is kept null (and not set to {})
            if (Object.getOwnPropertyNames(collapsibleChildren).length !== 0) {
                dag.node(n).expandedChildren = collapsibleChildren;
                dag.node(n).class = dag.node(n).class + " " + "expanded";
            }
        });

        self.update();
        self.fitDAG();

        // kludge for fixing edge crossings created by the initial dagre render
        self.collapseGraph();
        self.expandGraph();
    }

    this.update = function () {
        if (isForce) {
            updateForce();
        }
        if (isDag) {
            updateDag();
        }
    };

    function updateForce() {
        //creates node svg elements
        var d3Node = nodeLayer.selectAll("g.node").data(nodeData,
          function (d) {
              return d.name;
          }
        );
        var nodeElements = d3Node.enter().append("g")
            .attr("class", "node")
            .call(nodeDrag);
        nodeElements.append("circle")
            .attr("class", "nodeShape")
            .attr("r", defaultNodeRadius)
            .attr('id',
            function (d) {
                return ('node' + sanitize(d.name));
            })
            .on('click', function (d) {
            self.selectedNode = d;
            self.selectedEdge = null;
            $(this).trigger('nodeClick');
        })
            .on('dblclick', function (d) {
            d.fixed = false;
        })
            .on('focus', function (d) {
            if (self.elementOfInterest) {
                $('#' + self.elementOfInterest.id).css("filter", "");
                self.elementOfInterest = null;
            }
            self.elementOfInterest = this;
            $('#' + this.id).css("filter", "url(#drop-shadow)");
        });
        nodeElements.append("text")
            .attr("class", "nodeLabel")
            .attr("x", 0)
            .attr("y", ".35em")
            .attr("text-anchor", "middle")
            .attr('id', function (d) {
            return ('node' + sanitize(d.name) + 'text');
        })
            .text(function (d) {
            return d.name;
        });
        d3Node.exit().remove();

        //creates edge svg elements
        var d3Edge = edgeLayer.selectAll("g.edge").data(
        edgeData,
        function (d) {
            return (d.source.name + "-" + d.target.name);
        });
        var edgeElements = d3Edge.enter().append("g")
            .attr("class", "edge");

        edgeElements.append("defs")
            .append("marker")
            .attr('id',

        function (d) {
            return (sanitize(d.source.name) + "-" + sanitize(d.target.name) + 'arrow');
        })
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 10)
            .attr("refY", 0)
            .attr("markerWidth", 15)
            .attr("markerHeight", 15)
            .attr("markerUnits", "userSpaceOnUse")
            .attr("orient", "auto")
            .append("path")
            .attr("d", "M0,-5L10,0L0,5");

        edgeElements.append('path')
            .attr('class', 'edgePath')
            .attr('id',

        function (d) {
            return (sanitize(d.source.name) + "-" + sanitize(d.target.name));
        })
            .attr("marker-end", function (d) {
            return "url(#" + sanitize(d.source.name) + "-" + sanitize(d.target.name) + 'arrow' + ")";
        })
            .on('click', function (d) {
            self.selectedEdge = d;
            self.selectedNode = null;
            $(this).trigger('edgeClick');
        })
            .on('focus', function (d) {
            if (self.elementOfInterest) {
                $('#' + self.elementOfInterest.id).css("filter", "");
                self.elementOfInterest = null;
            }
            self.elementOfInterest = this;
            $('#' + this.id).css("filter", "url(#drop-shadow)");
        });
        edgeElements.append("text")
            .attr('class', 'edgeLabel')
            .attr("x", 0)
            .attr("y", ".10em")
            .attr('dy', -5)
            .attr("text-anchor", "middle")
            .append('textPath')
            .attr('startOffset', '50%')
            .attr("xlink:href", function (d) {
            return ('#' + sanitize(d.source.name) +
                "-" + sanitize(d.target.name));
        })
            .attr('id', function (d) {
            return (sanitize(d.source.name) + "-" + sanitize(d.target.name) + 'text');
        })
            .text(function (d) {
            return d.weight;
        });
        d3Edge.exit().remove();

        force.on("tick", function tick() {
            edgeLayer.selectAll("g.edge path").filter(".edgePath").attr("d", linkArc);
            d3Node.attr("transform", function (d) {
                return "translate(" + d.x + "," + d.y + ")";
            });
            d3Node.each(collide(0.5));
        });
        var k = Math.sqrt(numNodes / (width * height));
        force.charge(-10 / k).gravity(50 * k);
        force.start();
    }

    function updateDag() {
        var dagreRenderer = new dagreD3.render();
        dagreRenderer.arrows().normal = function normal(parent, id, edge, type) {
            var marker = parent.append("marker")
                .attr("id", id)
                .attr("viewBox", "-1 2 12 10")
                .attr("refX", 11)
                .attr("refY", 5)
                .attr("markerWidth", 8)
                .attr("markerHeight", 14)
                .attr("markerUnits", "strokeWidth")
                .attr("orient", "auto");

            var path = marker.append("path")
                .attr("d", "M 0 0 L 10 5 L 0 10")
                .style("stroke-width", 1.5)
                .style("stroke", "black")
                .style("stroke-linejoin", "round");
            dagreD3.util.applyStyle(path, edge[type + "Style"]);
        };
        dagreRenderer(elementHolderLayer, dag);
        elementHolderLayer.selectAll("g.node text")
            .attr("class", "nodeLabel");

        elementHolderLayer.selectAll("g.node rect")
            .attr("class", "nodeShape")
            .on("click", function (d) {
            if (d3.event.defaultPrevented) return;
            $(this).trigger('nodeClick', [dag.node(d).elem, d]);
        })
            .on('focus', function (d) {
            if (self.elementOfInterest) {
                $(self.elementOfInterest).css("filter", "");
                self.elementOfInterest = null;
            }
            self.elementOfInterest = this;
            $(this).css("filter", "url(#drop-shadow)");
        });

        var nodeDrag = d3.behavior.drag()
            .on("drag", drag);

        var edgeDrag = d3.behavior.drag()
            .on('drag', function (d) {
            translateEdge(dag.edge(d.v, d.w), d3.event.dx, d3.event.dy);
            $('#' + dag.edge(d.v, d.w).id + " .path").attr('d', calcPoints(d));
        });

        nodeDrag.call(elementHolderLayer.selectAll("g.node"));
        edgeDrag.call(elementHolderLayer.selectAll("g.edgePath"));
    }

    function drag(d) {
        if (isForce) {
            d.px += d3.event.dx;
            d.py += d3.event.dy;
            d.x += d3.event.dx;
            d.y += d3.event.dy;
        }
        if (isDag) {
            var node = d3.select(this),
                selectedNode = dag.node(d);
            var prevX = selectedNode.x,
                prevY = selectedNode.y;

            selectedNode.x += d3.event.dx;
            selectedNode.y += d3.event.dy;

            node.attr('transform', 'translate(' + selectedNode.x + ',' + selectedNode.y + ')');

            var dx = selectedNode.x - prevX,
                dy = selectedNode.y - prevY;

            $.each(dag.nodeEdges(d), function (i, e) {
                translateEdge(dag.edge(e.v, e.w), dx, dy);
                $('#' + dag.edge(e.v, e.w).id + " .path").attr('d', calcPoints(e));
            });
        }

    }

    /**********Force-directed graph only functions**********/

    this.addNode = function (nodeName, rawNodeData) {
        var nodePresent = _.find(nodeData, function (n) {
            return n.name == nodeName;
        });
        if (!nodePresent) {
            nodeData.push({
                name: nodeName
            });
            this.update();
            numNodes += 1;
        }
        rawNodeData = rawNodeData || 0;
        if (rawNodeData) {
            cfg.graphData.rawNodeData[nodeName] = rawNodeData;
        }
    };
    this.deleteNode = function (nodeName) {
        var retval = {
            'nodes': [],
                'edges': []
        };
        var node = _.find(nodeData, function (n) {
            return n.name == nodeName;
        });
        var i = 0;
        while (i < edgeData.length) {
            if ((edgeData[i].source === node) || (edgeData[i].target == node)) {
                retval.edges.push(edgeData[i]);
                edgeData.splice(i, 1);
            } else {
                i += 1;
            }
        }
        if (node !== undefined) {
            retval.nodes.push(node);
            nodeData.splice(nodeData.indexOf(node), 1);
            this.update();
            numNodes -= 1;
            self.selectedNode = null;
        }
        return retval;
    };
    this.addEdge = function (sourceName, targetName, weight, rawEdgeData) {
        var edgePresent = _.find(edgeData, function (e) {
            return e.source.name == sourceName && e.target.name == targetName;
        });
        var source = _.find(nodeData, function (n) {
            return n.name == sourceName;
        });
        var target = _.find(nodeData, function (n) {
            return n.name == targetName;
        });
        if (source && target && !edgePresent) {
            edgeData.push({
                "source": source,
                    "target": target,
                    "weight": weight
            });
            this.update();
        }
        rawEdgeData = rawEdgeData || 0;
        if (rawEdgeData) {
            cfg.graphData.rawEdgeData[sourceName + "-" + targetName] = rawEdgeData;
        }
    };
    this.deleteEdge = function (sourceName, targetName) {
        var edge = _.find(edgeData, function (e) {
            return e.source.name == sourceName && e.target.name == targetName;
        });

        edgeData.splice(edgeData.indexOf(edge), 1);
        self.selectedEdge = null;
        this.update();
    };

    this.pinAllNodes = function () {
        _.each(nodeData, function (node) {
            node.fixed = true;
        });
        this.update();
    };
    this.releaseAllNodes = function () {
        _.each(nodeData, function (node) {
            node.fixed = false;
        });
        this.update();
    };
    this.showAllEdgeText = function () {
        $(".edgeLabel").show();
    };
    this.hideAllEdgeText = function () {
        $(".edgeLabel").hide();
    };
    this.hideUnnamedNeurons = function () {
        var nodesToRemove = _.reject(nodeData, function (node) {
            return isNaN(node.name);
        });
        _.each(nodesToRemove, function (node) {
            var removed = self.deleteNode(node.name);
            hiddenNeurons.nodes = _.union(hiddenNeurons.nodes, removed.nodes);
            hiddenNeurons.edges = _.union(hiddenNeurons.edges, removed.edges);
        });
        this.update();
    };
    this.showUnnamedNeurons = function () {
        _.each(hiddenNeurons.nodes, function (node) {
            redrawNode(node);
        });
        _.each(hiddenNeurons.edges, function (edge) {
            self.addEdge(edge.source.name, edge.target.name,
            edge.weight);
        });
        hiddenNeurons = {
            'nodes': [],
            'edges': []
        };
    };

    this.getSelectedNodeRawData = function () {
        return cfg.graphData.rawNodeData[self.selectedNode.name];
    };
    this.getSelectedEdgeRawData = function () {
        return cfg.graphData.rawEdgeData[self.selectedEdge.source.name + "-" + self.selectedEdge.target.name];
    };

    this.generateCSV = function () {
        var csvList = [
            ["", "", "Target"],
            ["", ""]
        ];
        _.each(nodeData, function (node) {
            csvList[1].push(node.name);
        });
        for (i = 0; i < nodeData.length; i += 1) {
            row = [""];
            row.push(nodeData[i].name);
            for (j = 0; j < nodeData.length; j += 1) {
                var edge = _.find(edgeData, function (e) {
                    return e.source == nodeData[i] && e.target == nodeData[j];
                });
                edge ? row.push("=\"" + edge.weight + "\"") : row.push("=\"0\"");
            }
            csvList.push(row);
        }
        csvList[2][0] = "Source";

        var csvRows = [];
        for (var i = 0, l = csvList.length; i < l; i += 1) {
            csvRows.push(csvList[i].join(','));
        }
        var csvString = csvRows.join("%0A");
        var csvDownload = document.createElement('a');
        csvDownload.href = 'data:attachment/csv,' + csvString;
        csvDownload.target = '_blank';
        csvDownload.download = "circuit_diagram_" + $("label[for='" + selectedCombo + "']").text() + ".csv";

        document.body.appendChild(csvDownload);
        csvDownload.click();
        document.body.removeChild(csvDownload);
    };

    //sanitizes node names for the id attribute
    function sanitize(name) {
        return name.replace(/[^-_A-Z0-9:.]/ig, '');
    }

    function collide(alpha) {
        var quadtree = d3.geom.quadtree(nodeData);
        return function (d) {
            var nodeRadius = $('#node' + sanitize(d.name)).attr(
                'r');
            //1 is the padding
            var rb = 2 * nodeRadius + 1,
                nx1 = d.x - rb,
                nx2 = d.x + rb,
                ny1 = d.y - rb,
                ny2 = d.y + rb;
            quadtree.visit(function (quad, x1, y1, x2, y2) {
                if (quad.point && (quad.point !== d)) {
                    var x = d.x - quad.point.x,
                        y = d.y - quad.point.y,
                        l = Math.sqrt(x * x + y * y);
                    if (l < rb) {
                        l = (l - rb) / l * alpha;
                        d.x -= x *= l;
                        d.y -= y *= l;
                        quad.point.x += x;
                        quad.point.y += y;
                    }
                }
                return x1 > nx2 || x2 < nx1 || y1 > ny2 || y2 < ny1;
            });
        };
    }

    function linkArc(d) {
        var sourceSize = $('#node' + sanitize(d.source.name)).attr(
            'r');
        var targetSize = $('#node' + sanitize(d.target.name)).attr(
            'r');
        var sourceX = d.source.x;
        var sourceY = d.source.y;
        var targetX = d.target.x;
        var targetY = d.target.y;
        var theta = Math.atan((targetX - sourceX) / (targetY - sourceY));
        var phi = Math.atan((targetY - sourceY) / (targetX - sourceX));
        if (isNaN(sourceSize)) {
            sourceSize = defaultNodeRadius;
        }
        if (isNaN(targetSize)) {
            targetSize = defaultNodeRadius;
        }
        var sinTheta = sourceSize * Math.sin(theta);
        var cosTheta = sourceSize * Math.cos(theta);
        var sinPhi = targetSize * Math.sin(phi);
        var cosPhi = targetSize * Math.cos(phi);
        // Set the position of the link's end point at the source node
        // such that it is on the edge closest to the target node
        if (d.target.y > d.source.y) {
            sourceX = sourceX + sinTheta;
            sourceY = sourceY + cosTheta;
        } else {
            sourceX = sourceX - sinTheta;
            sourceY = sourceY - cosTheta;
        }
        // Set the position of the link's end point at the target node
        // such that it is on the edge closest to the source node
        if (d.source.x > d.target.x) {
            targetX = targetX + cosPhi;
            targetY = targetY + sinPhi;
        } else {
            targetX = targetX - cosPhi;
            targetY = targetY - sinPhi;
        }
        // Draw an arc between the two calculated points
        var dx = targetX - sourceX,
            dy = targetY - sourceY,
            dr = Math.sqrt(dx * dx + dy * dy);
        return "M" + sourceX + "," + sourceY + "A" + dr + "," + dr +
            " 0 0,1 " + targetX + "," + targetY;
    }

    function keydown() {
        switch (d3.event.keyCode) {
          //backspace key
            case 8:
                {
                    //prevents nagivation to previous page by backspace
                    var doPrevent = false;
                    var d = event.srcElement || event.target;
                    if ((d.tagName.toUpperCase() === 'INPUT' && (d.type.toUpperCase() === 'TEXT' || d.type.toUpperCase() === 'PASSWORD' || d.type.toUpperCase() === 'FILE' || d.type.toUpperCase() === 'EMAIL' || d.type.toUpperCase() === 'SEARCH' || d.type.toUpperCase() === 'DATE')) || d.tagName.toUpperCase() === 'TEXTAREA') {
                        doPrevent = d.readOnly || d.disabled;
                    } else {
                        doPrevent = true;
                    }
                    if (doPrevent) {
                        event.preventDefault();
                    }
                    if (self.selectedNode) {
                        self.deleteNode(self.selectedNode.name);
                        $(document).trigger('nodeDelete');
                    }
                    if (self.selectedEdge) {
                        self.deleteEdge(self.selectedEdge.source.name,
                        self.selectedEdge.target.name);
                        $(document).trigger('edgeDelete');

                    }
                    break;
                }
            //delete key
            case 46:
                {
                    if (self.selectedNode) {
                        self.deleteNode(self.selectedNode.name);
                        $(document).trigger('nodeDelete');
                    }
                    if (self.selectedEdge) {
                        self.deleteEdge(self.selectedEdge.source.name,
                        self.selectedEdge.target.name);
                        $(document).trigger('edgeDelete');

                    }
                }
        }
    }

    //same as add node, but retains position and fixed properties of the node
    //the node passed in must have already been draw and have the properties px, py, index, etc.
    function redrawNode(node) {
        nodeData.push(node);
        self.update();
        numNodes += 1;
    }

    /**********DAG only functions**********/

    //scales and fits the dag within the SVG container
    this.fitDAG = function () {
        var scale = Math.min(width / dag.graph().width, height / dag.graph().height);
        scale = scale > 1 ? 1 : scale -= 0.01;
        var xCenterOffset = Math.abs(((dag.graph().width * scale) - width) / 2);
        var yCenterOffset = Math.abs(((dag.graph().height * scale) - height) / 2);
        elementHolderLayer.attr("transform", "matrix(" + scale + ", 0, 0, " + scale + ", " + xCenterOffset + "," + yCenterOffset + ")");
        zoom.scale(scale);
        zoom.scaleExtent([0, 1.5]);
        zoom.translate([xCenterOffset, yCenterOffset]);
    };

    //toggles collapsing and expanding of a parent node
    this.toggleChildren = function (parent) {
        if (dag.node(parent).expandedChildren) {
            collapseChildren(parent);
        } else if (dag.node(parent).collapsedChildren) {
            expandChildren(parent);
        }
        self.update();
    };

    //fully collapses entire DAG
    this.collapseGraph = function () {
        //need to go in revers order so that parent nodes won't be collapsed until all of their children are collapsed
        dag.nodes().reverse().forEach(function (n) {
            if (dag.node(n).expandedChildren) {
                collapseChildren(n);
            }
        });
        self.update();
        self.fitDAG();
    };
    //fully expands entire DAG
    this.expandGraph = function () {
        //keep track of number of nodes expanded so that recursion can be terminated
        var nodesExpanded = 0;
        dag.nodes().forEach(function (n) {
            if (dag.node(n).collapsedChildren) {
                nodesExpanded += 1;
                expandChildren(n);
            }
        });
        if (nodesExpanded) {
            self.expandGraph();
        } else {
            //if no nodes were expanded, it means the graph has been completely expanded.
            self.update();
            self.fitDAG();
        }
    };

    function translateEdge(e, dx, dy) {
        e.points.forEach(function (p) {
            p.x = p.x + dx;
            p.y = p.y + dy;
        });
    }

    //taken from dagre-d3 source code (not the exact same)
    function calcPoints(e) {
        var edge = dag.edge(e.v, e.w),
            tail = dag.node(e.v),
            head = dag.node(e.w);
        var points = edge.points.slice(1, edge.points.length - 1);
        points.unshift(intersectRect(tail, points[0]));
        points.push(intersectRect(head, points[points.length - 1]));
        return d3.svg.line()
            .x(function (d) {
            return d.x;
        })
            .y(function (d) {
            return d.y;
        })
            .interpolate("basis")
        (points);
    }

    //taken from dagre-d3 source code (not the exact same)
    function intersectRect(node, point) {
        var x = node.x;
        var y = node.y;
        var dx = point.x - x;
        var dy = point.y - y;
        var w = $("#" + node.id + " rect").attr('width') / 2;
        var h = $("#" + node.id + " rect").attr('height') / 2;
        var sx = 0,
            sy = 0;
        if (Math.abs(dy) * w > Math.abs(dx) * h) {
            // Intersection is top or bottom of rect.
            if (dy < 0) {
                h = -h;
            }
            sx = dy === 0 ? 0 : h * dx / dy;
            sy = h;
        } else {
            // Intersection is left or right of rect.
            if (dx < 0) {
                w = -w;
            }
            sx = w;
            sy = dx === 0 ? 0 : w * dy / dx;
        }
        return {
            x: x + sx,
            y: y + sy
        };
    }

    function collapseChildren(parent) {
        dag.node(parent).class = dag.node(parent).class.replace("expanded", '');
        dag.node(parent).class = dag.node(parent).class + " " + "collapsed";
        collapse(dag.node(parent).expandedChildren);
        dag.node(parent).collapsedChildren = dag.node(parent).expandedChildren;
        dag.node(parent).expandedChildren = null;
    }

    function expandChildren(parent) {
        dag.node(parent).class = dag.node(parent).class.replace("collapsed", '');
        dag.node(parent).class = dag.node(parent).class + " " + "expanded";
        expand(parent, dag.node(parent).collapsedChildren);
        dag.node(parent).expandedChildren = dag.node(parent).collapsedChildren;
        dag.node(parent).collapsedChildren = null;
    }

    //recursively collapses subgraph of parent
    function collapse(expandedChildren) {
        for (var child in expandedChildren) {
            dag.removeNode(child);
            collapse(expandedChildren[child].expandedChildren);
        }
    }
    //recursively expands subgraph of parent
    function expand(parent, collapsedChildren) {
        for (var child in collapsedChildren) {
            dag.setNode(child, collapsedChildren[child]);
            dag.setEdge(parent, child, {
                lineInterpolate: 'basis',
                id: parent + "-" + child
            });
            //only the parent's immediate collapsed children are expanded.
            //the parent's children's expanded children (not collapsed children) are expanded for the rest of the graph.
            expand(child, collapsedChildren[child].expandedChildren);
        }
    }

};
