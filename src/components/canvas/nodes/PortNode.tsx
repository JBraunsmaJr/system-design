import {Handle, type Node, type NodeProps, Position} from '@xyflow/react';
import {ArrowRightFromLine, ArrowRightToLine} from 'lucide-react';
import type {BoundaryPortNodeData} from '../../../domain/canvas/boundaryPorts';
import {grabHandleId, sourceHandleId, targetHandleId} from '../../../domain/canvas/edgeAnchoring';
import {getEdgeType} from '../../../domain/canvas/edgeRegistry';

type PortNodeType = Node<BoundaryPortNodeData, 'port'>;

/**
 * A connection from the level above, drawn on the boundary of the
 * sub-diagram it leads into - see domain/canvas/boundaryPorts.ts.
 *
 * Laid out like an Unreal collapsed-graph tunnel: inbound ports sit in a
 * column on the left with their pin facing in, outbound ports on the
 * right with their pin facing in from the other side. The pin is the only
 * side that connects, so a wire can only ever leave towards the inside.
 *
 * The handle ids follow EdgeHandles' scheme (`source-<side>`,
 * `target-<side>`, `grab-<side>`) so the anchoring and release
 * resolution that every other node goes through work here unchanged.
 */
export function PortNode({data}: NodeProps<PortNodeType>) {
    const {port} = data;
    const isIn = port.side === 'in';
    const pinSide = isIn ? 'right' : 'left';
    const position = isIn ? Position.Right : Position.Left;
    const accent = port.color ?? getEdgeType(port.edgeType).color;
    const where = port.peerDepth > 1 ? ` (${port.peerDepth} levels up)` : '';
    const title = isIn
        ? `From ${port.peerLabel}${where}${port.connectionLabel ? ` - ${port.connectionLabel}` : ''}`
        : `To ${port.peerLabel}${where}${port.connectionLabel ? ` - ${port.connectionLabel}` : ''}`;
    const status = port.bound
        ? 'Wired to a node inside.'
        : 'Not wired to anything inside yet - drag from the pin to the node that handles it.';

    return (
        <div
            className={`boundary-port boundary-port--${port.side}${port.bound ? ' is-bound' : ' is-unbound'}`}
            style={{['--port-accent' as string]: accent}}
            title={`${title}\n${status}\nDouble-click to go up a level.`}
        >
      <span className="boundary-port__dir" aria-hidden="true">
        {isIn ? <ArrowRightToLine size={12}/> : <ArrowRightFromLine size={12}/>}
      </span>
            <span className="boundary-port__text">
        <span className="boundary-port__label">{port.peerLabel}</span>
        <span className="boundary-port__sub">
          {isIn ? 'in' : 'out'}
            {port.connectionLabel ? ` · ${port.connectionLabel}` : ''}
        </span>
      </span>
            <span className="boundary-port__pin" aria-hidden="true"/>

            <Handle
                id={targetHandleId(pinSide)}
                type="target"
                position={position}
                className="edge-anchor"
                isConnectableStart={false}
                isConnectableEnd={false}
            />
            <Handle
                id={sourceHandleId(pinSide)}
                type="source"
                position={position}
                className="edge-anchor"
                isConnectableStart={false}
                isConnectableEnd={false}
            />
            <Handle
                id={grabHandleId(pinSide)}
                type="source"
                position={position}
                className={`edge-grab edge-grab--${pinSide} boundary-port__grab`}
                isConnectableEnd={false}
            />
        </div>
    );
}
