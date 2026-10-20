public class CodecTests
{
    [Fact]
    public void Reads() => Assert.Equal(1, Codec.Read(1));
}
