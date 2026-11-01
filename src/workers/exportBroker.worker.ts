// SharedWorker that connects SkypeLens tabs privately (see utils/exportBroker.ts).
// It only passes requests and MessagePorts along; export data never goes through it.
import { createBrokerHub } from "../utils/exportBroker";

const hub = createBrokerHub();

(self as unknown as { onconnect: ((event: MessageEvent) => void) | null }).onconnect = (
  event,
) => {
  hub.connect(event.ports[0]);
};
