import logfmt from "../../utils/logfmt.js";

function onSocketError(err) {
    logfmt("error", {
        event: "Websocket Socket Errors",
        msg: "onSocketError() triggered",
    });
}
export default onSocketError;
