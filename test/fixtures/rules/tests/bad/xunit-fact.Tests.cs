public class StreamTests
{
    [Fact]
    public void Get_ReturnsTheFrame() => Assert.Equal(1, Frames.Get("a").Id);
}
