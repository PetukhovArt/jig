public class StreamController : ControllerBase
{
    /// <summary>
    /// Reads the stream id from the route and returns the frame.
    /// </summary>
    [HttpGet("{id}")]
    public IActionResult Get(string id) => Ok(_frames.Get(id));
}
