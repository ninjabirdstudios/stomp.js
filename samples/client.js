/*/////////////////////////////////////////////////////////////////////////////
/// @summary Implements a simple STOMP over WebSocket test client.
/// @author Russell Klenk (russ@ninjabirdstudios.com)
///////////////////////////////////////////////////////////////////////////80*/
var timer            = -1;
var connector        = null;
var outputText       = null;
var connectButton    = null;
var disconnectButton = null;

function sendMessage()
{
    if (connector)
    {
        var frame      = connector.createMessage('/topic/test1');
        frame.setBodyFromObject({
            command    : 'foo',
            data       : {
                field1 : 'bar',
                field2 : 1.234,
                field3 : true,
                field4 : null
            }
        });
        connector.send(frame);
    }
}

function connectClick()
{
    connector.url      = document.getElementById('url').value;
    connector.host     = document.getElementById('hostname').value;
    connector.username = document.getElementById('username').value;
    connector.password = document.getElementById('password').value;
    connector.connect();
}

function disconnectClick()
{
    outputText.value += 'Starting disconnect...\n';
    connector.disconnect(true);
    if (timer >= 0)
    {
        clearInterval(timer);
        timer  =-1;
    }
}

function errorHandler(conn, error)
{
    outputText.value += 'An error occurred:\n';
    outputText.value += error+'\n';
}

function readyHandler(conn)
{
    outputText.value += 'The connector is ready.\n';
    timer = setInterval(sendMessage, 5000);
}

function subscribeHandler(conn)
{
    outputText.value += 'Subscribing to topics.\n';
    var frame = conn.createSubscribe(0, '/topic/test1');
    conn.send(frame);
}

function rejectedHandler(conn)
{
    outputText.value += 'The server rejected the supplied credentials.\n'
}

function disconnectHandler(conn)
{
    outputText.value += 'Disconnected.\n';
}

function messageHandler(conn, frame)
{
    outputText.value   += 'Received frame '+frame.command+':\n';
    if (frame.command === 'MESSAGE')
    {
        var obj   = frame.getObjectFromBody();
        var json  = JSON.stringify(obj, null, '\t'); // make it pretty
        outputText.value += json + '\n';
    }
}

function contentReady()
{
    document.removeEventListener('DOMContentLoaded', contentReady);
    connector                = new STOMP.ClientConnector();
    outputText               = document.getElementById('output_text');
    connectButton            = document.getElementById('connect');
    disconnectButton         = document.getElementById('disconnect');
    connectButton.onclick    = connectClick;
    disconnectButton.onclick = disconnectClick;
    connector.on('error',      errorHandler);
    connector.on('ready',      readyHandler);
    connector.on('message',    messageHandler);
    connector.on('rejected',   rejectedHandler);
    connector.on('subscribe',  subscribeHandler);
    connector.on('disconnect', disconnectHandler);
}

// run as soon as the DOM is ready.
document.addEventListener('DOMContentLoaded', contentReady);
